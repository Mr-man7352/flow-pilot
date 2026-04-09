import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

  return server;
};
