import { NextRequest, NextResponse } from "next/server";
import { createFlowPilotMcpClient } from "@/lib/mcp-client";
import { log } from "console";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// POST /api/workflows
// Called by WorkflowPreviewCard when the user clicks "Create Workflow".
// Instead of hitting n8n directly, we route through the MCP server's
// create_workflow tool — keeping the architecture: Web → MCP → n8n.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get("Authorization");
  const expectedKey = process.env.MCP_API_KEY;

  if (
    !authHeader?.startsWith("Bearer ") ||
    authHeader.slice(7) !== expectedKey
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name: string;
    workflowJson: unknown; // may arrive as object or string
    description?: string;
  };

  const { name, description = "" } = body;

  // Normalise workflowJson to a string for the MCP tool
  let workflowJsonString: string;
  try {
    workflowJsonString =
      typeof body.workflowJson === "string"
        ? body.workflowJson
        : JSON.stringify(body.workflowJson);
  } catch {
    return NextResponse.json(
      { error: "Invalid workflow JSON" },
      { status: 400 },
    );
  }

  // Connect to MCP server
  let mcpClient: Awaited<ReturnType<typeof createFlowPilotMcpClient>>;
  try {
    mcpClient = await createFlowPilotMcpClient();
  } catch (err) {
    console.error("[workflows] MCP server unavailable:", err);
    return NextResponse.json(
      { error: "MCP server is not reachable. Is it running?" },
      { status: 503 },
    );
  }

  try {
    // Call the MCP server's create_workflow tool
    const toolResult = await mcpClient.callTool({
      name: "create_workflow",
      arguments: {
        name,
        description,
        workflowJson: workflowJsonString,
      },
    });
    console.log(
      "[workflows] raw toolResult:",
      JSON.stringify(toolResult, null, 2),
    );

    await mcpClient.close().catch(() => {});

    // The MCP tool returns { content: [{ type: "text", text: "..." }] }
    const resultText =
      Array.isArray(toolResult.content) && toolResult.content.length > 0
        ? (toolResult.content[0] as { text: string }).text
        : "";
    // Check for failure signal in result text
    if (resultText.startsWith("Failed") || resultText.startsWith("Invalid")) {
      return NextResponse.json({ error: resultText }, { status: 400 });
    }

    // Extract the workflow ID and links from the MCP tool's success response.
    // create_workflow returns text like:
    //   ✅ Workflow **<name>** created successfully!
    //   • ID: <id>
    //   • Link: <url>
    //   • Webhook URL: <url>   (optional)
    const idMatch = resultText.match(/• \*\*ID:\*\* (.+)/);
    const linkMatch = resultText.match(/• \*\*Link:\*\* (.+)/);
    const webhookMatch = resultText.match(/• \*\*Webhook URL:\*\* (.+)/);

    const workflowId = idMatch?.[1]?.trim();
    const link = linkMatch?.[1]?.trim();
    const webhookUrl = webhookMatch?.[1]?.trim();

    if (!workflowId || !link) {
      // Unexpected format — return the raw text so the UI can display it
      return NextResponse.json({ message: resultText });
    }

    return NextResponse.json({
      id: workflowId,
      name,
      link,
      webhookUrl,
    });
  } catch (err) {
    await mcpClient.close().catch(() => {});
    console.error("[workflows] create_workflow tool error:", err);
    return NextResponse.json(
      { error: "Workflow creation failed. Check the MCP server logs." },
      { status: 500 },
    );
  }
}
