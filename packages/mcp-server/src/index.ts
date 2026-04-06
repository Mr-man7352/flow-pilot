import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "flowpilot",
  version: "1.0.0",
});

// Tools will be registered here

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FlowPilot MCP server running...");
}

main();
