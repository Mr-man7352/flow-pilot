import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

//  The MCP server runs in stateless mode, so each client is independent.

export async function createFlowPilotMcpClient(): Promise<Client> {
  const mcpServerUrl = process.env.MCP_SERVER_URL;
  const mcpApiKey = process.env.MCP_API_KEY;

  if (!mcpServerUrl) {
    throw new Error(
      "MCP_SERVER_URL is not set. Add it to apps/web/.env (e.g. http://localhost:3001)",
    );
  }
  if (!mcpApiKey) {
    throw new Error("MCP_API_KEY is not set in apps/web/.env");
  }

  const client = new Client({ name: "flowpilot-web", version: "1.0.0" });

  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpServerUrl}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${mcpApiKey}` },
      },
    },
  );

  await client.connect(transport);
  return client;
}

/** Extract the text content from a raw MCP CallToolResult */
export function getMcpText(result: unknown): string {
  const content = (result as { content?: { type: string; text: string }[] })
    ?.content;
  if (!Array.isArray(content)) return String(result ?? "");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
