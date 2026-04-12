import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createFlowPilotMcpClient, getMcpText } from "@/lib/mcp-client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Intent → model tier
// ---------------------------------------------------------------------------
type Tier = "simple" | "complex" | "create";

function classifyIntent(message: string): Tier {
  const text = message.toLowerCase();
  const createKeywords = [
    "create", "build", "make", "design", "generate", "set up", "new workflow",
  ];
  const complexKeywords = [
    "debug", "diagnose", "fix", "why", "failing", "error", "broken",
    "inspect", "analyse", "analyze", "list", "show", "activate",
    "deactivate", "execute", "run", "trigger",
  ];
  if (createKeywords.some((kw) => text.includes(kw))) return "create";
  if (complexKeywords.some((kw) => text.includes(kw))) return "complex";
  return "simple";
}

// ---------------------------------------------------------------------------
// System prompt — tool-based, no text markers
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are FlowPilot, an AI assistant that helps users manage n8n automation workflows.

Always prefer calling a tool over describing what you would do. Available tools:

• draft_workflow    — Call when the user asks to create/build/design a workflow.
                      Generate the complete n8n workflow JSON and pass it here.
                      Do NOT call create_workflow directly — the user reviews the preview first.

• list_workflows    — List all n8n workflows (optionally filter by name).

• get_workflow      — Get the full definition of a specific workflow by ID or name.

• activate_workflow — Activate or deactivate a workflow.

• get_credentials   — List configured n8n credentials (names and types only).

• execute_workflow  — Trigger a workflow execution and wait for the result.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
N8N WORKFLOW JSON — STRICT RULES (for draft_workflow)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED TOP-LEVEL KEYS: nodes (array), connections (object), settings (object)

Every node MUST have: id (UUID v4), name, type, typeVersion (int), position ([x,y]), parameters ({})

Node types:
- "n8n-nodes-base.webhook"         typeVersion: 2
- "n8n-nodes-base.httpRequest"     typeVersion: 4
- "n8n-nodes-base.emailSend"       typeVersion: 2
- "n8n-nodes-base.set"             typeVersion: 3
- "n8n-nodes-base.if"              typeVersion: 2
- "n8n-nodes-base.code"            typeVersion: 2
- "n8n-nodes-base.noOp"            typeVersion: 1

Connections: { "SourceName": { "main": [[{ "node": "TargetName", "type": "main", "index": 0 }]] } }
Settings: { "executionOrder": "v1" }

Ask ONE clarifying question if the request is too vague before calling draft_workflow.`;

// ---------------------------------------------------------------------------
// Build ai-SDK tools backed by the MCP client
// Every execute() calls mcpClient.callTool() — n8n is never called directly.
// ---------------------------------------------------------------------------
function buildMcpTools(mcpClient: Client) {
  return {
    draft_workflow: tool({
      description:
        "Design and preview an n8n workflow WITHOUT creating it. " +
        "Call this when the user asks to create/build/make a workflow. " +
        "The user will confirm before creation runs.",
      inputSchema: z.object({
        name: z.string().describe("The workflow name"),
        description: z
          .string()
          .describe("Original natural-language description from the user"),
        workflowJson: z
          .string()
          .describe(
            "Complete n8n workflow JSON string — must include nodes, connections, and settings",
          ),
      }),
      execute: async (args) => {
        const result = await mcpClient.callTool({
          name: "draft_workflow",
          arguments: args,
        });
        return getMcpText(result);
      },
    }),

    list_workflows: tool({
      description: "List all n8n workflows. Optionally filter by name.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe(
            "Optional name filter — only return workflows whose name contains this string",
          ),
      }),
      execute: async (args) => {
        const result = await mcpClient.callTool({
          name: "list_workflows",
          arguments: args,
        });
        return getMcpText(result);
      },
    }),

    get_workflow: tool({
      description:
        "Get the full definition of a specific n8n workflow by ID or name.",
      inputSchema: z.object({
        workflowIdOrName: z
          .string()
          .describe("The workflow ID (numeric string) or its exact/partial name"),
      }),
      execute: async (args) => {
        const result = await mcpClient.callTool({
          name: "get_workflow",
          arguments: args,
        });
        return getMcpText(result);
      },
    }),

    activate_workflow: tool({
      description: "Activate or deactivate an n8n workflow by name or ID.",
      inputSchema: z.object({
        workflowIdOrName: z
          .string()
          .describe("The workflow ID or name"),
        active: z
          .boolean()
          .describe("true to activate, false to deactivate"),
      }),
      execute: async (args) => {
        const result = await mcpClient.callTool({
          name: "activate_workflow",
          arguments: args,
        });
        return getMcpText(result);
      },
    }),

    get_credentials: tool({
      description:
        "List all credentials configured in n8n. Returns name and type only — no secrets.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await mcpClient.callTool({
          name: "get_credentials",
          arguments: {},
        });
        return getMcpText(result);
      },
    }),

    execute_workflow: tool({
      description:
        "Trigger an n8n workflow execution by ID and return its result.",
      inputSchema: z.object({
        workflowId: z
          .string()
          .describe("The n8n workflow ID (numeric string)"),
      }),
      execute: async (args) => {
        const result = await mcpClient.callTool({
          name: "execute_workflow",
          arguments: args,
        });
        return getMcpText(result);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // 1. Validate API key
  const authHeader = req.headers.get("Authorization");
  const expectedKey = process.env.MCP_API_KEY;

  if (
    !authHeader?.startsWith("Bearer ") ||
    authHeader.slice(7) !== expectedKey
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // 2. Hash key → userId
  const userId = createHash("sha256").update(authHeader.slice(7)).digest("hex");

  // 3. Parse body
  const { messages, sessionId } = await req.json();

  // 4. Resolve or create chat session
  let session;
  if (sessionId) {
    session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  }

  const lastMessage = messages[messages.length - 1];
  const content = Array.isArray(lastMessage.parts)
    ? lastMessage.parts
        .filter((p: { type: string }) => p.type === "text")
        .map((p: { text: string }) => p.text)
        .join("")
    : (lastMessage.content ?? "");

  if (!session) {
    session = await prisma.chatSession.create({
      data: { userId, title: content.slice(0, 60) },
    });
  }

  // 5. Persist user message
  if (lastMessage?.role === "user") {
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content },
    });
  }

  // 6. Pick model tier
  const tier = classifyIntent(content);
  const model =
    tier === "simple"
      ? anthropic("claude-haiku-4-5-20251001")
      : anthropic("claude-sonnet-4-6");

  // 7. Connect MCP client
  let mcpClient: Client;
  try {
    mcpClient = await createFlowPilotMcpClient();
  } catch (err) {
    console.error("[chat] MCP server unavailable:", err);
    return new Response(
      JSON.stringify({
        error:
          "The FlowPilot MCP server is not reachable. Make sure it is running (MCP_SERVER_URL).",
      }),
      { status: 503 },
    );
  }

  // 8. Build tools backed by MCP client
  const tools = buildMcpTools(mcpClient);

  // 9. Stream response — Claude calls MCP tools; ai@6 uses stopWhen for multi-step
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages.slice(-10)),
    system: {
      role: "system" as const,
      content: SYSTEM_PROMPT,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    tools,
    stopWhen: stepCountIs(5), // allow up to 5 tool-call rounds per message
    maxOutputTokens: 4000,
    async onFinish({ finishReason, text }) {
      // Close MCP connection
      await mcpClient.close().catch(() => {});

      if (finishReason === "length") {
        console.warn("[chat] Response truncated by token limit");
      }

      // Persist final assistant text
      if (text.trim()) {
        await prisma.chatMessage.create({
          data: { sessionId: session.id, role: "assistant", content: text },
        });
      }

      // Bump session
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date(), title: content.slice(0, 60) },
      });
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { "X-Session-Id": session.id },
  });
}
