"use client";

import { useState } from "react";

export interface WorkflowPreview {
  name: string;
  nodeCount: number;
  json: object;
}

interface WorkflowPreviewCardProps {
  preview: WorkflowPreview;
  onConfirm: () => void;
  onEdit: () => void;
}

export default function WorkflowPreviewCard({
  preview,
  onConfirm,
  onEdit,
}: WorkflowPreviewCardProps) {
  const [jsonOpen, setJsonOpen] = useState(false);

  return (
    <div className="border-l-4 border-blue-500 bg-white rounded-xl shadow-sm px-4 py-3 max-w-xl w-full">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500 mb-0.5">
            Workflow Preview
          </p>
          <p className="text-sm font-medium text-zinc-800">{preview.name}</p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold px-2 py-0.5">
          {preview.nodeCount} node{preview.nodeCount !== 1 ? "s" : ""}
        </span>
      </div>

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

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Create Workflow
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
        >
          Edit Description
        </button>
      </div>
    </div>
  );
}
