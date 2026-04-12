"use client";

import { useState } from "react";

export interface WorkflowPreview {
  name: string;
  nodeCount: number;
  json: object;
  description?: string; // original user request, used for audit log
}

type CardStatus = "idle" | "loading" | "success" | "error";

interface CreatedWorkflow {
  id: string;
  name: string;
  link: string;
  webhookUrl?: string;
}

interface WorkflowPreviewCardProps {
  preview: WorkflowPreview;
  apiKey: string;
  onDismiss: () => void;
  onEdit: () => void;
}

export default function WorkflowPreviewCard({
  preview,
  apiKey,
  onDismiss,
  onEdit,
}: WorkflowPreviewCardProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [status, setStatus] = useState<CardStatus>("idle");
  const [created, setCreated] = useState<CreatedWorkflow | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreate = async () => {
    setStatus("loading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: preview.name,
          workflowJson: preview.json,
          description: preview.description ?? preview.name,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? `Unexpected error (${res.status})`);
        return;
      }

      setCreated(data as CreatedWorkflow);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Network error — please retry.",
      );
    }
  };

  return (
    <div className="border-l-4 border-blue-500 bg-white rounded-xl shadow-sm px-4 py-3 max-w-xl w-full">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500 mb-0.5">
            {status === "success" ? "✅ Workflow Created" : "Workflow Preview"}
          </p>
          <p className="text-sm font-medium text-zinc-800">
            {created?.name ?? preview.name}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold px-2 py-0.5">
          {preview.nodeCount} node{preview.nodeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Success state                                                        */}
      {/* ------------------------------------------------------------------ */}
      {status === "success" && created && (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 space-y-1">
            <p>
              <span className="font-semibold">ID:</span> {created.id}
            </p>
            {created.webhookUrl && (
              <p>
                <span className="font-semibold">Webhook URL:</span>{" "}
                <code className="break-all">{created.webhookUrl}</code>
              </p>
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <a
              href={created.link}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              View in n8n →
            </a>
            <button
              onClick={onDismiss}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Idle / loading / error state                                         */}
      {/* ------------------------------------------------------------------ */}
      {status !== "success" && (
        <>
          {/* JSON toggle */}
          <button
            onClick={() => setJsonOpen((prev) => !prev)}
            className="mt-3 text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1"
          >
            {jsonOpen ? "Hide JSON ▲" : "Show full JSON ▼"}
          </button>

          {jsonOpen && (
            <pre className="mt-2 overflow-y-auto max-h-[300px] rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-xs text-zinc-700 font-mono">
              {JSON.stringify(preview.json, null, 2)}
            </pre>
          )}

          {/* Error banner */}
          {status === "error" && errorMsg && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <span className="font-semibold">Error:</span> {errorMsg}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleCreate}
              disabled={status === "loading"}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {status === "loading" ? (
                <>
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Creating…
                </>
              ) : status === "error" ? (
                "Try Again"
              ) : (
                "Create Workflow"
              )}
            </button>
            <button
              onClick={onEdit}
              disabled={status === "loading"}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Edit Description
            </button>
          </div>
        </>
      )}
    </div>
  );
}
