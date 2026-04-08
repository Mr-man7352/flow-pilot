import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 1. Validate API key
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

  // 2. Hash the key → userId (never store the raw key)
  const userId = createHash("sha256").update(authHeader.slice(7)).digest("hex");

  // 3. Parse the request body
  const { messages, sessionId } = await req.json();

  // 4. Resolve or create a chat session
  let session;
  if (sessionId) {
    session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  }

  const lastMessage = messages[messages.length - 1];
  const content = Array.isArray(lastMessage.parts)
    ? lastMessage.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("")
    : (lastMessage.content ?? "");

  if (!session) {
    session = await prisma.chatSession.create({
      data: { userId, title: content.slice(0, 60) },
    });
  }

  // 5. Save the latest user message
  if (lastMessage?.role === "user") {
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content },
    });
  }

  // 6. Stream the response from OpenAI
  const result = streamText({
    model: openai("gpt-5-nano"),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 1500,
    async onFinish({ text }) {
      // 7. Save the assistant reply once streaming is complete
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "assistant", content: text },
      });
      // 8. Bump the session's updatedAt
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date(), title: content.slice(0, 60) },
      });
    },
  });

  // 9. Return the stream, injecting sessionId so the client can track it
  return result.toUIMessageStreamResponse({
    headers: { "X-Session-Id": session.id },
  });
}
