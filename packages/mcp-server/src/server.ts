import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
  return server;
};
