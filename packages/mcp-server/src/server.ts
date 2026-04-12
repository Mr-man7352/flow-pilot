import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { pool } from "./db.js";

// In-memory TTL cache

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const sanitizeWorkflow = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(sanitizeWorkflow);

  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([key]) => !/secret|password|token|key/i.test(key))
        .map(([key, value]) => [key, sanitizeWorkflow(value)]),
    );
  }

  return obj;
};

export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "flowpilot",
    version: "1.0.0",
  });

  server.registerTool(
    "list_workflows",
    {
      description: "List all n8n workflows. Optionally filter by name.",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe(
            "Optional name filter — only return workflows whose name contains this string (case-insensitive)",
          ),
      },
    },
    async ({ filter }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      const allWorkflows: {
        id: string;
        name: string;
        active: boolean;
        nodes: unknown[];
        updatedAt: string;
      }[] = [];
      let cursor: string | undefined = undefined;

      do {
        const url = new URL(`${baseUrl}/api/v1/workflows`);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);

        const response = await fetch(url.toString(), {
          headers: { "X-N8N-API-KEY": apiKey! },
        });

        const data = (await response.json()) as {
          data: {
            id: string;
            name: string;
            active: boolean;
            nodes: unknown[];
            updatedAt: string;
          }[];
          nextCursor?: string;
        };

        console.warn("n8n raw response:", JSON.stringify(data, null, 2));

        allWorkflows.push(...data.data);
        cursor = data.nextCursor;
      } while (cursor);

      const filteredWorkflows = filter
        ? allWorkflows.filter((wf) =>
            wf.name.toLowerCase().includes(filter!.toLowerCase()),
          )
        : allWorkflows;

      const rows = filteredWorkflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        active: wf.active,
        nodeCount: wf.nodes.length,
        updatedAt: new Date(wf.updatedAt).toLocaleDateString("en-GB"),
      }));

      const header = `| Name | Status | Nodes | Last Updated |\n|------|--------|-------|--------------|\n`;
      const tableRows = rows
        .map(
          (wf) =>
            `| ${wf.name} | ${wf.active ? "🟢 Active" : "⚪ Inactive"} | ${wf.nodeCount} | ${wf.updatedAt} |`,
        )
        .join("\n");

      const table =
        rows.length > 0
          ? header + tableRows
          : "No workflows found. Would you like to create your first one?";

      return {
        content: [{ type: "text", text: table }],
      };
    },
  );

  server.registerTool(
    "get_workflow",
    {
      description:
        "Get the full definition of a specific n8n workflow by its ID or name.",
      inputSchema: {
        workflowIdOrName: z
          .string()
          .describe(
            "The workflow ID (numeric string) or its exact/partial name",
          ),
      },
    },
    async ({ workflowIdOrName }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      // If input looks like a name (not a numeric ID), resolve it first
      let workflowId = workflowIdOrName;
      const looksLikeId = /^\d+$/.test(workflowIdOrName);

      if (!looksLikeId) {
        const listResponse = await fetch(
          `${baseUrl}/api/v1/workflows?limit=100`,
          {
            headers: { "X-N8N-API-KEY": apiKey! },
          },
        );

        const listData = (await listResponse.json()) as {
          data: { id: string; name: string }[];
        };

        const match = listData.data.find((wf) =>
          wf.name.toLowerCase().includes(workflowIdOrName.toLowerCase()),
        );

        if (!match) {
          const suggestions = listData.data
            .map((wf) => `• ${wf.name} (ID: ${wf.id})`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Workflow not found for: "${workflowIdOrName}".\n\nAvailable workflows:\n${suggestions}`,
              },
            ],
          };
        }

        workflowId = match.id;
      }

      const response = await fetch(
        `${baseUrl}/api/v1/workflows/${workflowId}`,
        {
          headers: { "X-N8N-API-KEY": apiKey! },
        },
      );

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Workflow not found for: "${workflowIdOrName}". Use list_workflows to see available workflows.`,
            },
          ],
        };
      }

      const workflow = (await response.json()) as {
        id: string;
        name: string;
        active: boolean;
        nodes: { name: string; type: string }[];
        connections: unknown;
      };

      const sanitized = sanitizeWorkflow(workflow) as typeof workflow;

      const summary =
        `**${sanitized.name}** (ID: ${sanitized.id}) — ${sanitized.active ? "🟢 Active" : "⚪ Inactive"}\n\n` +
        sanitized.nodes
          .map((n, i) => `Step ${i + 1}: ${n.name} (${n.type})`)
          .join(" → ");

      return {
        content: [
          {
            type: "text",
            text:
              summary +
              "\n\n---\n\n```json\n" +
              JSON.stringify(sanitized, null, 2) +
              "\n```",
          },
        ],
      };
    },
  );

  server.registerTool(
    "activate_workflow",
    {
      description: "Activate or deactivate an n8n workflow by name or ID.",
      inputSchema: {
        workflowIdOrName: z
          .string()
          .describe("The workflow ID (numeric string) or its name"),
        active: z
          .boolean()
          .describe("true to activate the workflow, false to deactivate it"),
      },
    },
    async ({ workflowIdOrName, active }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      // Step 1: Resolve name → id if needed
      let workflowId = workflowIdOrName;
      let workflowName = workflowIdOrName;
      const looksLikeId = /^\d+$/.test(workflowIdOrName);

      if (!looksLikeId) {
        const listResponse = await fetch(
          `${baseUrl}/api/v1/workflows?limit=100`,
          { headers: { "X-N8N-API-KEY": apiKey! } },
        );
        const listData = (await listResponse.json()) as {
          data: { id: string; name: string; active: boolean }[];
        };

        const match = listData.data.find((wf) =>
          wf.name.toLowerCase().includes(workflowIdOrName.toLowerCase()),
        );

        if (!match) {
          const suggestions = listData.data
            .map((wf) => `• ${wf.name} (ID: ${wf.id})`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Workflow not found for: "${workflowIdOrName}".\n\nAvailable workflows:\n${suggestions}`,
              },
            ],
          };
        }

        workflowId = match.id;
        workflowName = match.name;

        // Step 2: No-op check — already in target state?
        if (match.active === active) {
          const state = active ? "already active" : "already inactive";
          return {
            content: [
              {
                type: "text",
                text: `Workflow "${workflowName}" is ${state}. No changes made.`,
              },
            ],
          };
        }
      }

      // Step 3: PATCH the workflow state
      const response = await fetch(
        `${baseUrl}/api/v1/workflows/${workflowId}`,
        {
          method: "PATCH",
          headers: {
            "X-N8N-API-KEY": apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ active }),
        },
      );

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update workflow "${workflowName}". n8n returned status ${response.status}.`,
            },
          ],
        };
      }

      const action = active ? "activated" : "deactivated";

      await pool.query(
        `INSERT INTO audit_logs ("id", "workflowId", "action", "createdAt")
   VALUES (gen_random_uuid(), $1, $2, NOW())`,
        [workflowId, action],
      );

      return {
        content: [
          {
            type: "text",
            text: `Workflow "${workflowName}" has been ${action}.`,
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // US-07: List Available Credentials
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_credentials",
    {
      description:
        "List all credentials configured in the n8n instance. Returns name and type only — no secrets, tokens, or passwords.",
      inputSchema: {},
    },
    async () => {
      const CACHE_KEY = "credentials";
      const TTL_MS = 60_000; // 60 seconds

      // Return cached result if still fresh
      const cached =
        getCached<{ id: string; name: string; type: string }[]>(CACHE_KEY);
      if (cached) {
        return buildCredentialsResponse(cached);
      }

      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      const response = await fetch(`${baseUrl}/api/v1/credentials`, {
        headers: { "X-N8N-API-KEY": apiKey! },
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch credentials. n8n returned status ${response.status}.`,
            },
          ],
        };
      }

      const raw = (await response.json()) as {
        data: Record<string, unknown>[];
      };

      // Allowlist: id, name, type only — strip everything else
      const credentials = raw.data.map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.name ?? ""),
        type: String(c.type ?? ""),
      }));

      setCached(CACHE_KEY, credentials, TTL_MS);

      return buildCredentialsResponse(credentials);
    },
  );

  server.registerTool(
    "create_workflow",
    {
      description: `Create a new n8n workflow by POSTing a generated JSON definition to the n8n API.

BEFORE calling this tool:
1. If the user's description is vague or ambiguous, ask ONE clarifying question first.
2. Generate a complete, valid n8n workflow JSON yourself and pass it as workflowJson.

WORKFLOW JSON STRUCTURE:
Every node requires: id (UUID v4), name, type (e.g. "n8n-nodes-base.webhook"), typeVersion (integer), position ([x, y]), parameters (object).
Connections: { "SourceNodeName": { "main": [[{ "node": "TargetNode", "type": "main", "index": 0 }]] } }
Settings: { "executionOrder": "v1" }

COMMON NODE TYPES:
n8n-nodes-base.webhook · n8n-nodes-base.httpRequest · n8n-nodes-base.emailSend
n8n-nodes-base.code · n8n-nodes-base.set · n8n-nodes-base.if · n8n-nodes-base.noOp

FEW-SHOT EXAMPLE (webhook → HTTP request):
{
  "nodes": [
    { "id": "a1b2c3d4-0001-0001-0001-000000000001", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [250, 300], "parameters": { "httpMethod": "POST", "path": "my-path", "webhookId": "a1b2c3d4-0001-0001-0001-000000000001" } },
    { "id": "a1b2c3d4-0001-0001-0001-000000000002", "name": "HTTP Request", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4, "position": [500, 300], "parameters": { "url": "https://api.example.com/data", "method": "POST" } }
  ],
  "connections": { "Webhook": { "main": [[{ "node": "HTTP Request", "type": "main", "index": 0 }]] } },
  "settings": { "executionOrder": "v1" }
}`,
      inputSchema: {
        name: z.string().describe("The workflow name"),
        description: z
          .string()
          .describe(
            "Original natural language description from the user (used for audit logging)",
          ),
        workflowJson: z
          .string()
          .describe(
            "Complete n8n workflow JSON string — must include nodes (array), connections (object), and settings (object)",
          ),
      },
    },
    async ({ name, description, workflowJson }) => {
      console.warn(
        `Creating workflow: ${name}\nDescription: ${description}\nWorkflow JSON: ${workflowJson}`,
      );
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;
      const n8nPublicUrl = process.env.N8N_PUBLIC_URL ?? baseUrl;

      // Step 1: Parse the JSON
      type N8nNode = {
        id?: string;
        name?: string;
        type?: string;
        typeVersion?: number;
        position?: [number, number];
        parameters?: Record<string, unknown>;
      };

      type WorkflowPayload = {
        nodes?: N8nNode[];
        connections?: Record<string, unknown>;
        settings?: Record<string, unknown>;
      };

      let parsedWorkflow: WorkflowPayload;
      try {
        parsedWorkflow = JSON.parse(workflowJson) as WorkflowPayload;
      } catch (err) {
        console.warn("[workflows] Failed to parse workflow JSON:", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid JSON: ${(err as Error).message}. Please fix the syntax and try again.`,
            },
          ],
        };
      }

      // Step 2: Structural validation
      const errors: string[] = [];
      if (
        !Array.isArray(parsedWorkflow.nodes) ||
        parsedWorkflow.nodes.length === 0
      ) {
        errors.push("'nodes' must be a non-empty array");
      }
      if (
        typeof parsedWorkflow.connections !== "object" ||
        parsedWorkflow.connections === null ||
        Array.isArray(parsedWorkflow.connections)
      ) {
        errors.push("'connections' must be a plain object");
      }
      if (errors.length > 0) {
        console.warn("[workflows] Workflow JSON validation errors:", errors);
        return {
          content: [
            {
              type: "text" as const,
              text: `Workflow JSON validation failed:\n${errors.map((e) => `• ${e}`).join("\n")}\n\nPlease correct and retry.`,
            },
          ],
        };
      }

      // Step 3: Build POST payload
      const payload = {
        name,
        nodes: parsedWorkflow.nodes,
        connections: parsedWorkflow.connections,
        settings: parsedWorkflow.settings ?? { executionOrder: "v1" },
      };

      // Step 4: Compute JSON hash for audit log
      const jsonHash = createHash("sha256")
        .update(workflowJson)
        .digest("hex")
        .slice(0, 16);

      // Step 5: POST to n8n
      const response = await fetch(`${baseUrl}/api/v1/workflows`, {
        method: "POST",
        headers: {
          "X-N8N-API-KEY": apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Log failed attempt (non-fatal)
        await pool
          .query(
            `INSERT INTO audit_logs ("id", "workflowId", "action", "description", "metadata", "createdAt")
             VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
            [
              "unknown",
              "workflow_create_failed",
              description,
              JSON.stringify({ jsonHash, status: "failed", error: errorText }),
            ],
          )
          .catch(() => {
            console.warn(
              "[workflows] Failed to log audit entry for failed workflow creation:",
              errorText,
            );
          });
        console.warn(
          `[workflows] Failed to create workflow. n8n responded with status ${response.status}: ${errorText}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to create workflow. n8n returned status ${response.status}:\n${errorText}\n\nPlease refine the description or correct the workflow JSON and try again.`,
            },
          ],
        };
      }

      const created = (await response.json()) as { id: string; name: string };

      // Step 6: Detect webhook node and build webhook URL
      const webhookNode = (parsedWorkflow.nodes ?? []).find(
        (n) => n.type === "n8n-nodes-base.webhook",
      );
      const webhookPath = webhookNode?.parameters?.path as string | undefined;
      const webhookUrl = webhookPath
        ? `${n8nPublicUrl}/webhook/${webhookPath}`
        : undefined;

      // Step 7: Audit log — success
      console.warn(
        "[workflows] About to write audit log for created workflow:",
        created.id,
      );
      try {
        await pool.query(
          `INSERT INTO audit_logs ("id", "workflowId", "action", "description", "metadata", "createdAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
          [
            created.id,
            "workflow_created",
            description,
            JSON.stringify({ jsonHash, status: "success" }),
          ],
        );
        console.warn("[workflows] Audit log written successfully");
      } catch (auditErr) {
        console.error("[workflows] Audit log failed:", auditErr);
      }

      // Step 8: Build response
      let resultText =
        `✅ Workflow **${created.name}** created successfully!\n\n` +
        `• **ID:** ${created.id}\n` +
        `• **Link:** ${n8nPublicUrl}/workflow/${created.id}`;

      if (webhookUrl) {
        resultText += `\n• **Webhook URL:** ${webhookUrl}`;
      }
      console.log(`[workflows] Workflow created with ID ${created.id}.`);
      return {
        content: [{ type: "text" as const, text: resultText }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // draft_workflow — design & validate a workflow JSON without creating it.
  // Claude calls this when the user asks to create a workflow. The UI then
  // shows a preview card; the user explicitly confirms before creation runs.
  // -------------------------------------------------------------------------
  server.registerTool(
    "draft_workflow",
    {
      description: `Design and preview an n8n workflow without creating it.
Use this tool WHENEVER the user asks to create, build, make, or design a workflow.
Do NOT call create_workflow directly — the user must confirm the preview first.

Pass a fully-valid n8n workflow JSON string as workflowJson.
Every node requires: id (UUID v4), name, type, typeVersion, position ([x,y]), parameters.
Connections: { "SourceNode": { "main": [[{ "node": "TargetNode", "type": "main", "index": 0 }]] } }
Settings: { "executionOrder": "v1" }`,
      inputSchema: {
        name: z.string().describe("The workflow name"),
        description: z
          .string()
          .describe("Original natural-language description from the user"),
        workflowJson: z
          .string()
          .describe(
            "Complete n8n workflow JSON string — must include nodes (array), connections (object), and settings (object)",
          ),
      },
    },
    async ({ name, description, workflowJson }) => {
      console.warn(
        `Drafting workflow: ${name}\nDescription: ${description}\nJSON: ${workflowJson}`,
      );
      type N8nNode = {
        id?: string;
        name?: string;
        type?: string;
        typeVersion?: number;
        position?: [number, number];
        parameters?: Record<string, unknown>;
      };

      type WorkflowPayload = {
        nodes?: N8nNode[];
        connections?: Record<string, unknown>;
        settings?: Record<string, unknown>;
      };

      // Step 1: Parse
      let parsedWorkflow: WorkflowPayload;
      try {
        parsedWorkflow = JSON.parse(workflowJson) as WorkflowPayload;
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid JSON: ${(err as Error).message}. Please fix the syntax and try again.`,
            },
          ],
        };
      }

      // Step 2: Structural validation
      const errors: string[] = [];
      if (
        !Array.isArray(parsedWorkflow.nodes) ||
        parsedWorkflow.nodes.length === 0
      ) {
        errors.push("'nodes' must be a non-empty array");
      }
      if (
        typeof parsedWorkflow.connections !== "object" ||
        parsedWorkflow.connections === null ||
        Array.isArray(parsedWorkflow.connections)
      ) {
        errors.push("'connections' must be a plain object");
      }
      if (errors.length > 0) {
        console.warn("Workflow JSON validation errors:", errors);
        return {
          content: [
            {
              type: "text" as const,
              text: `Workflow JSON validation failed:\n${errors.map((e) => `• ${e}`).join("\n")}\n\nPlease correct and retry.`,
            },
          ],
        };
      }

      // Step 3: Return preview data — NO side effects
      const preview = {
        name,
        description,
        nodeCount: parsedWorkflow.nodes!.length,
        json: parsedWorkflow,
      };
      console.warn("Workflow preview:", preview);

      return {
        content: [
          {
            type: "text" as const,
            // Embed the structured preview in a machine-readable block so the
            // UI can extract it without LLM re-summarisation.
            text: `FLOWPILOT_DRAFT_PREVIEW\n${JSON.stringify(preview)}`,
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // execute_workflow — trigger a workflow and return the execution result.
  // Polls n8n until the execution finishes (up to 30 s) and logs to DB.
  // -------------------------------------------------------------------------
  server.registerTool(
    "execute_workflow",
    {
      description:
        "Trigger an n8n workflow execution by ID and return its status and result. Works for manually-triggered workflows.",
      inputSchema: {
        workflowId: z.string().describe("The n8n workflow ID (numeric string)"),
      },
    },
    async ({ workflowId }) => {
      const baseUrl = process.env.N8N_BASE_URL;
      const apiKey = process.env.N8N_API_KEY;

      // Step 1: Trigger execution
      const triggerRes = await fetch(
        `${baseUrl}/api/v1/workflows/${workflowId}/execute`,
        {
          method: "POST",
          headers: {
            "X-N8N-API-KEY": apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      if (!triggerRes.ok) {
        const errText = await triggerRes.text();
        return {
          content: [
            {
              type: "text" as const,
              text:
                triggerRes.status === 404
                  ? `Workflow "${workflowId}" not found. Use list_workflows to confirm the ID.`
                  : `Failed to trigger workflow. n8n returned ${triggerRes.status}: ${errText}`,
            },
          ],
        };
      }

      const triggerData = (await triggerRes.json()) as {
        data?: { executionId?: string };
        executionId?: string;
      };

      const executionId =
        triggerData.data?.executionId ?? triggerData.executionId;

      if (!executionId) {
        // Some n8n versions return the execution inline
        return {
          content: [
            {
              type: "text" as const,
              text: `Workflow triggered, but no execution ID was returned. It may have run synchronously. Check n8n for results.`,
            },
          ],
        };
      }

      // Step 2: Write initial execution record
      const recordId = `exec_${Date.now()}`;
      await pool
        .query(
          `INSERT INTO workflow_executions (id, workflow_id, execution_id, status, started_at)
           VALUES ($1, $2, $3, 'running', NOW())`,
          [recordId, workflowId, executionId],
        )
        .catch(() => {}); // non-fatal if table doesn't exist yet

      // Step 3: Poll until finished or 30 s timeout
      const POLL_INTERVAL_MS = 2000;
      const MAX_ATTEMPTS = 15;
      let attempts = 0;

      // n8n returns either { data: { finished, status, stoppedAt } } or the fields top-level.
      // Two separate types to avoid duplicate 'data' property.
      type ExecPayload = {
        finished?: boolean;
        status?: string;
        stoppedAt?: string;
      };
      type ExecStatus = {
        data?: ExecPayload;
      } & ExecPayload;

      while (attempts < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        attempts++;

        const statusRes = await fetch(
          `${baseUrl}/api/v1/executions/${executionId}`,
          { headers: { "X-N8N-API-KEY": apiKey! } },
        );

        if (!statusRes.ok) break;

        const statusData = (await statusRes.json()) as ExecStatus;
        const execPayload = statusData.data ?? statusData;
        const finished = execPayload.finished;
        const status = execPayload.status ?? "unknown";

        if (finished || (status !== "running" && status !== "new")) {
          const resultSummary = {
            status,
            stoppedAt: execPayload.stoppedAt,
          };

          // Update execution record
          await pool
            .query(
              `UPDATE workflow_executions
               SET status = $1, finished_at = NOW(), result = $2
               WHERE id = $3`,
              [status, JSON.stringify(resultSummary), recordId],
            )
            .catch(() => {});

          const emoji = status === "success" ? "✅" : "❌";
          return {
            content: [
              {
                type: "text" as const,
                text: `${emoji} Workflow execution **${status}**\n• Execution ID: ${executionId}\n• Finished at: ${execPayload.stoppedAt ?? "unknown"}`,
              },
            ],
          };
        }
      }

      // Timed out — update record and report
      await pool
        .query(
          `UPDATE workflow_executions SET status = 'timeout', finished_at = NOW() WHERE id = $1`,
          [recordId],
        )
        .catch(() => {});

      return {
        content: [
          {
            type: "text" as const,
            text: `⏳ Workflow is still running after 30 s (execution ID: ${executionId}). Check n8n for the final result.`,
          },
        ],
      };
    },
  );

  return server;
};

// ---------------------------------------------------------------------------
// Helper — shared response builder for get_credentials (used for cached
// and fresh responses)
// ---------------------------------------------------------------------------
function buildCredentialsResponse(
  credentials: { id: string; name: string; type: string }[],
) {
  if (credentials.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "No credentials are configured yet.\n\nTo add credentials, visit the n8n editor and go to **Settings → Credentials**.",
        },
      ],
    };
  }

  const list = credentials.map((c) => `• ${c.name} (${c.type})`).join("\n");

  return {
    content: [
      {
        type: "text" as const,
        text: `Available credentials:\n\n${list}`,
      },
    ],
  };
}
