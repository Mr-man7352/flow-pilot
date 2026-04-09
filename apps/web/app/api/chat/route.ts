import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText } from "ai";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Tier = "simple" | "complex" | "create";

function classifyIntent(message: string): Tier {
  const text = message.toLowerCase();

  const createKeywords = [
    "create",
    "build",
    "make",
    "design",
    "generate",
    "set up",
    "new workflow",
  ];
  const complexKeywords = [
    "debug",
    "diagnose",
    "fix",
    "why",
    "failing",
    "error",
    "broken",
    "inspect",
    "analyse",
    "analyze",
  ];

  if (createKeywords.some((kw) => text.includes(kw))) return "create";
  if (complexKeywords.some((kw) => text.includes(kw))) return "complex";
  return "simple";
}

const SYSTEM_PROMPT = `You are FlowPilot, an assistant that helps users create and manage n8n automation workflows.

When a user asks you to create a workflow, before doing anything else, output a workflow preview in this exact format on its own line:

<<<WORKFLOW_PREVIEW>>>
{"name": "<workflow name>", "nodeCount": <number>, "json": <full workflow JSON object>}
<<<END_WORKFLOW_PREVIEW>>>

After the preview block, write only one short sentence like "Here's your workflow preview — confirm to create it or edit your description to adjust it."
Do not explain the workflow nodes or structure in text. The preview card will show all that.

Only output this block when the user is explicitly asking to create a new workflow.

If the user is just asking simple questions. answer them as concisely as possible without unnecessary explanations, just do simple chatting.

`;

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

  // 2. Hash the key → userId (never store the raw key)
  const userId = createHash("sha256").update(authHeader.slice(7)).digest("hex");

  // 3. Parse the request body
  const { messages, sessionId } = await req.json();

  // 4. Resolve or create a chat session
  let session;
  if (sessionId) {
    session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  }

  const lastMessage = messages[messages.length - 1];
  const content = Array.isArray(lastMessage.parts)
    ? lastMessage.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("")
    : (lastMessage.content ?? "");

  if (!session) {
    session = await prisma.chatSession.create({
      data: { userId, title: content.slice(0, 60) },
    });
  }

  // 5. Save the latest user message
  if (lastMessage?.role === "user") {
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content },
    });
  }

  const tier = classifyIntent(content);
  const model =
    tier === "simple"
      ? anthropic("claude-haiku-4-5-20251001")
      : anthropic("claude-sonnet-4-6");

  // 6. Stream the response from OpenAI
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages.slice(-6)),
    system: {
      role: "system" as const,
      content: SYSTEM_PROMPT,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    maxOutputTokens: 4000,
    async onFinish({ finishReason, text }) {
      if (finishReason === "length") {
        // Model hit the token limit mid-output
        throw new Error(
          "Workflow or the response is too large to generate. Pleasesimplify.",
        );
      }
      // 7. Save the assistant reply once streaming is complete
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "assistant", content: text },
      });
      // 8. Bump the session's updatedAt
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date(), title: content.slice(0, 60) },
      });
    },
  });

  // 9. Return the stream, injecting sessionId so the client can track it
  return result.toUIMessageStreamResponse({
    headers: { "X-Session-Id": session.id },
  });
}
