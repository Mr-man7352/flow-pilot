import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "flowpilot",
    version: "1.0.0",
  });

  server.registerTool(
    "list_workflows",
    { description: "List all workflows from n8n" },
    async () => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      const response = await fetch(`${baseUrl}/api/v1/workflows`, {
        headers: { "X-N8N-API-KEY": apiKey! },
      });

      const data = (await response.json()) as {
        data: { id: string; name: string; active: boolean }[];
      };

      const workflows = data.data
        .map(
          (wf) =>
            `• ${wf.name} (id: ${wf.id}) — ${wf.active ? "active" : "inactive"}`,
        )
        .join("\n");

      return {
        content: [{ type: "text", text: workflows || "No workflows found." }],
      };
    },
  );

  return server;
};
