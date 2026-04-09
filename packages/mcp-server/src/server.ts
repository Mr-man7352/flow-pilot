import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pool } from "./db.js";

// ---------------------------------------------------------------------------
// In-memory TTL cache (US-07)
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------

const sanitizeWorkflow = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(sanitizeWorkflow);

  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([key]) => !/secret|password|token|key/i.test(key))
        .map(([key, value]) => [key, sanitizeWorkflow(value)]),
    );
  }

  return obj;
};

export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "flowpilot",
    version: "1.0.0",
  });

  server.registerTool(
    "list_workflows",
    {
      description: "List all n8n workflows. Optionally filter by name.",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe(
            "Optional name filter — only return workflows whose name contains this string (case-insensitive)",
          ),
      },
    },
    async ({ filter }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      const allWorkflows: {
        id: string;
        name: string;
        active: boolean;
        nodes: unknown[];
        updatedAt: string;
      }[] = [];
      let cursor: string | undefined = undefined;

      do {
        const url = new URL(`${baseUrl}/api/v1/workflows`);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);

        const response = await fetch(url.toString(), {
          headers: { "X-N8N-API-KEY": apiKey! },
        });

        const data = (await response.json()) as {
          data: {
            id: string;
            name: string;
            active: boolean;
            nodes: unknown[];
            updatedAt: string;
          }[];
          nextCursor?: string;
        };

        console.error("n8n raw response:", JSON.stringify(data, null, 2));

        allWorkflows.push(...data.data);
        cursor = data.nextCursor;
      } while (cursor);

      const filteredWorkflows = filter
        ? allWorkflows.filter((wf) =>
            wf.name.toLowerCase().includes(filter!.toLowerCase()),
          )
        : allWorkflows;

      const rows = filteredWorkflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        active: wf.active,
        nodeCount: wf.nodes.length,
        updatedAt: new Date(wf.updatedAt).toLocaleDateString("en-GB"),
      }));

      const header = `| Name | Status | Nodes | Last Updated |\n|------|--------|-------|--------------|\n`;
      const tableRows = rows
        .map(
          (wf) =>
            `| ${wf.name} | ${wf.active ? "🟢 Active" : "⚪ Inactive"} | ${wf.nodeCount} | ${wf.updatedAt} |`,
        )
        .join("\n");

      const table =
        rows.length > 0
          ? header + tableRows
          : "No workflows found. Would you like to create your first one?";

      return {
        content: [{ type: "text", text: table }],
      };
    },
  );

  server.registerTool(
    "get_workflow",
    {
      description:
        "Get the full definition of a specific n8n workflow by its ID or name.",
      inputSchema: {
        workflowIdOrName: z
          .string()
          .describe(
            "The workflow ID (numeric string) or its exact/partial name",
          ),
      },
    },
    async ({ workflowIdOrName }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      // If input looks like a name (not a numeric ID), resolve it first
      let workflowId = workflowIdOrName;
      const looksLikeId = /^\d+$/.test(workflowIdOrName);

      if (!looksLikeId) {
        const listResponse = await fetch(
          `${baseUrl}/api/v1/workflows?limit=100`,
          {
            headers: { "X-N8N-API-KEY": apiKey! },
          },
        );

        const listData = (await listResponse.json()) as {
          data: { id: string; name: string }[];
        };

        const match = listData.data.find((wf) =>
          wf.name.toLowerCase().includes(workflowIdOrName.toLowerCase()),
        );

        if (!match) {
          const suggestions = listData.data
            .map((wf) => `• ${wf.name} (ID: ${wf.id})`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Workflow not found for: "${workflowIdOrName}".\n\nAvailable workflows:\n${suggestions}`,
              },
            ],
          };
        }

        workflowId = match.id;
      }

      const response = await fetch(
        `${baseUrl}/api/v1/workflows/${workflowId}`,
        {
          headers: { "X-N8N-API-KEY": apiKey! },
        },
      );

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Workflow not found for: "${workflowIdOrName}". Use list_workflows to see available workflows.`,
            },
          ],
        };
      }

      const workflow = (await response.json()) as {
        id: string;
        name: string;
        active: boolean;
        nodes: { name: string; type: string }[];
        connections: unknown;
      };

      const sanitized = sanitizeWorkflow(workflow) as typeof workflow;

      const summary =
        `**${sanitized.name}** (ID: ${sanitized.id}) — ${sanitized.active ? "🟢 Active" : "⚪ Inactive"}\n\n` +
        sanitized.nodes
          .map((n, i) => `Step ${i + 1}: ${n.name} (${n.type})`)
          .join(" → ");

      return {
        content: [
          {
            type: "text",
            text:
              summary +
              "\n\n---\n\n```json\n" +
              JSON.stringify(sanitized, null, 2) +
              "\n```",
          },
        ],
      };
    },
  );

  server.registerTool(
    "activate_workflow",
    {
      description: "Activate or deactivate an n8n workflow by name or ID.",
      inputSchema: {
        workflowIdOrName: z
          .string()
          .describe("The workflow ID (numeric string) or its name"),
        active: z
          .boolean()
          .describe("true to activate the workflow, false to deactivate it"),
      },
    },
    async ({ workflowIdOrName, active }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      // Step 1: Resolve name → id if needed
      let workflowId = workflowIdOrName;
      let workflowName = workflowIdOrName;
      const looksLikeId = /^\d+$/.test(workflowIdOrName);

      if (!looksLikeId) {
        const listResponse = await fetch(
          `${baseUrl}/api/v1/workflows?limit=100`,
          { headers: { "X-N8N-API-KEY": apiKey! } },
        );
        const listData = (await listResponse.json()) as {
          data: { id: string; name: string; active: boolean }[];
        };

        const match = listData.data.find((wf) =>
          wf.name.toLowerCase().includes(workflowIdOrName.toLowerCase()),
        );

        if (!match) {
          const suggestions = listData.data
            .map((wf) => `• ${wf.name} (ID: ${wf.id})`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Workflow not found for: "${workflowIdOrName}".\n\nAvailable workflows:\n${suggestions}`,
              },
            ],
          };
        }

        workflowId = match.id;
        workflowName = match.name;

        // Step 2: No-op check — already in target state?
        if (match.active === active) {
          const state = active ? "already active" : "already inactive";
          return {
            content: [
              {
                type: "text",
                text: `Workflow "${workflowName}" is ${state}. No changes made.`,
              },
            ],
          };
        }
      }

      // Step 3: PATCH the workflow state
      const response = await fetch(
        `${baseUrl}/api/v1/workflows/${workflowId}`,
        {
          method: "PATCH",
          headers: {
            "X-N8N-API-KEY": apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ active }),
        },
      );

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update workflow "${workflowName}". n8n returned status ${response.status}.`,
            },
          ],
        };
      }

      const action = active ? "activated" : "deactivated";

      await pool.query(
        `INSERT INTO audit_logs ("id", "workflowId", "action", "createdAt")
   VALUES (gen_random_uuid(), $1, $2, NOW())`,
        [workflowId, action],
      );

      return {
        content: [
          {
            type: "text",
            text: `Workflow "${workflowName}" has been ${action}.`,
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // US-07: List Available Credentials
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_credentials",
    {
      description:
        "List all credentials configured in the n8n instance. Returns name and type only — no secrets, tokens, or passwords.",
      inputSchema: {},
    },
    async () => {
      const CACHE_KEY = "credentials";
      const TTL_MS = 60_000; // 60 seconds

      // Return cached result if still fresh
      const cached = getCached<{ id: string; name: string; type: string }[]>(
        CACHE_KEY,
      );
      if (cached) {
        return buildCredentialsResponse(cached);
      }

      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      const response = await fetch(`${baseUrl}/api/v1/credentials`, {
        headers: { "X-N8N-API-KEY": apiKey! },
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch credentials. n8n returned status ${response.status}.`,
            },
          ],
        };
      }

      const raw = (await response.json()) as {
        data: Record<string, unknown>[];
      };

      // Allowlist: id, name, type only — strip everything else
      const credentials = raw.data.map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.name ?? ""),
        type: String(c.type ?? ""),
      }));

      setCached(CACHE_KEY, credentials, TTL_MS);

      return buildCredentialsResponse(credentials);
    },
  );

  return server;
};

// ---------------------------------------------------------------------------
// Helper — shared response builder for get_credentials (used for cached
// and fresh responses)
// ---------------------------------------------------------------------------
function buildCredentialsResponse(
  credentials: { id: string; name: string; type: string }[],
) {
  if (credentials.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "No credentials are configured yet.\n\nTo add credentials, visit the n8n editor and go to **Settings → Credentials**.",
        },
      ],
    };
  }

  const list = credentials
    .map((c) => `• ${c.name} (${c.type})`)
    .join("\n");

  return {
    content: [
      {
        type: "text" as const,
        text: `Available credentials:\n\n${list}`,
      },
    ],
  };
}
