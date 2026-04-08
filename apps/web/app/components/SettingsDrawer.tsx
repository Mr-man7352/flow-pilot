"use client";

import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
}

export default function SettingsDrawer({ open, onClose, onSave }: Props) {
  const [value, setValue] = useState("");

  // Load existing key on open
  useEffect(() => {
    if (open) {
      setValue(localStorage.getItem("mcp_api_key") ?? "");
    }
  }, [open]);

  const handleSave = () => {
    localStorage.setItem("mcp_api_key", value.trim());
    onSave(value.trim());
    onClose();
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed bottom-0 left-0 top-0 z-50 flex w-80 flex-col border-r border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <span className="font-semibold text-zinc-800">Settings</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              API Key
            </label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste your MCP API key"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Stored locally in your browser. Never sent to any third party.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={!value.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
