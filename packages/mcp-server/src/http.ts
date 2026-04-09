import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authMiddleware } from "./middleware/auth.js";
import { createMcpServer } from "./server.js";

export const createHttpServer = () => {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.use("*", authMiddleware);

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Stateless: each request gets its own server + transport instance
  app.post("/mcp", async (c) => {
    const { incoming, outgoing } = c.env;

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    console.error(
      "Received MCP request, connecting server and handling request...",
    );
    await server.connect(transport);
    await transport.handleRequest(incoming, outgoing);
  });

  const port = Number(process.env.MCP_SERVER_PORT ?? 3002);

  const server = serve({ fetch: app.fetch, port });

  server.on("listening", () => {
    console.error(`FlowPilot HTTP server listening on port ${port}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} busy → retrying on ${port + 1}`);
      serve({ fetch: app.fetch, port: port + 1 });
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  return app;
};
