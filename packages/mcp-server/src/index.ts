import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpServer } from "./http.js";
import { createMcpServer } from "./server.js";
import "dotenv/config";

async function main() {
  // HTTP server (with auth) for the Chat UI
  createHttpServer();

  // Stdio transport for Claude Desktop
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("FlowPilot MCP server running...");
}

main();
