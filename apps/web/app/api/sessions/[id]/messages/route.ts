import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(messages);
}
