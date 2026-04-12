import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

export const createHttpServer = () => {
  const port = Number(process.env.MCP_SERVER_PORT ?? 3002);
  console.warn(`Starting FlowPilot HTTP server on port ${port}...`);

  const httpServer = createServer(async (req, res) => {
    // Health
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      );
      return;
    }

    // Auth
    const authHeader = req.headers["authorization"];
    const expectedKey = process.env.MCP_API_KEY;
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // MCP
    if (req.url === "/mcp" && req.method === "POST") {
      console.error(
        "Received MCP request, connecting server and handling request...",
      );
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  httpServer.listen(port, () => {
    console.error(`FlowPilot HTTP server listening on port ${port}`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    console.error(err);
    process.exit(1);
  });

  return httpServer;
};
