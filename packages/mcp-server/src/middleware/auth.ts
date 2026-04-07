import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";

export const authMiddleware = createMiddleware(async (c, next) => {
  // /health bypasses auth
  if (c.req.path === "/health") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  const expectedKey = process.env.MCP_API_KEY;

  if (!expectedKey) {
    console.error("MCP_API_KEY is not set in environment variables");
    return c.json(
      { error: "Unauthorized", code: 401, message: "Server misconfiguration" },
      401,
    );
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Unauthorized",
        code: 401,
        message: "Missing Authorization header",
      },
      401,
    );
  }

  const providedKey = authHeader.slice("Bearer ".length);

  const encoder = new TextEncoder();
  const a = encoder.encode(providedKey);
  const b = encoder.encode(expectedKey);

  // Keys must be the same length for timingSafeEqual
  const keysMatch = a.length === b.length && timingSafeEqual(a, b);

  if (!keysMatch) {
    console.warn(
      `[AUTH FAIL] ${new Date().toISOString()} | IP: ${c.req.header("x-forwarded-for") ?? "unknown"} | UA: ${c.req.header("user-agent") ?? "unknown"}`,
    );
    return c.json(
      { error: "Unauthorized", code: 401, message: "Invalid API key" },
      401,
    );
  }

  return next();
});
