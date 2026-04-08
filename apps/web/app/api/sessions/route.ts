import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const expectedKey = process.env.MCP_API_KEY;

  if (
    !authHeader?.startsWith("Bearer ") ||
    authHeader.slice(7) !== expectedKey
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const userId = createHash("sha256").update(authHeader.slice(7)).digest("hex");

  const sessions = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, title: true, updatedAt: true },
  });

  return Response.json(sessions);
}
