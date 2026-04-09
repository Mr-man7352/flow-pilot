"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import SettingsDrawer from "./SettingsDrawer";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import WorkflowPreviewCard, { WorkflowPreview } from "./WorkflowPreviewCard";

interface Session {
  id: string;
  title: string;
  updatedAt: string;
}

function stripPreviewMarker(text: string): string {
  return text
    .replace(/<<<WORKFLOW_PREVIEW>>>[\s\S]*?<<<END_WORKFLOW_PREVIEW>>>/g, "")
    .trim();
}

export default function ChatInterface() {
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workflowPreview, setWorkflowPreview] =
    useState<WorkflowPreview | null>(null);
  const [apiKey, setApiKey] = useState(
    typeof window !== "undefined"
      ? (localStorage.getItem("mcp_api_key") ?? "")
      : "",
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSessionIdRef = useRef<string | null>(null);

  const authHeader = `Bearer ${apiKey}`;

  // Fetch session list
  const fetchSessions = async () => {
    const res = await fetch("/api/sessions", {
      headers: { Authorization: authHeader },
    });
    if (res.ok) setSessions(await res.json());
  };

  // Keep ref in sync with state
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    fetchSessions();
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: { Authorization: authHeader },
        fetch: async (url, init) => {
          // Inject current sessionId into every request
          const body = JSON.parse((init?.body as string) ?? "{}");
          const res = await fetch(url, {
            ...init,
            body: JSON.stringify({
              ...body,
              sessionId: activeSessionIdRef.current,
            }),
          });
          // Capture session ID from first response in a new conversation
          const newSessionId = res.headers.get("X-Session-Id");
          if (newSessionId && !activeSessionIdRef.current) {
            activeSessionIdRef.current = newSessionId;
            setActiveSessionId(newSessionId);
          }
          return res;
        },
      }),
    [apiKey], // No longer depends on activeSessionId — ref handles that
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    messages: initialMessages,
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const text = m.parts.find((p) => p.type === "text")?.text ?? "";
      const match = text.match(
        /<<<WORKFLOW_PREVIEW>>>\s*([\s\S]*?)\s*<<<END_WORKFLOW_PREVIEW>>>/,
      );
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          setWorkflowPreview({
            name: data.name,
            nodeCount: data.nodeCount,
            json: data.json,
          });
        } catch {
          // malformed JSON, ignore
        }
        break;
      }
    }
  }, [messages]);

  // Refresh session list after each completed response
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      fetchSessions();
    }
  }, [status]);

  // Load a past session
  const loadSession = async (session: Session) => {
    const res = await fetch(`/api/sessions/${session.id}/messages`);
    if (!res.ok) return;

    const dbMessages: { id: string; role: string; content: string }[] =
      await res.json();

    const converted: UIMessage[] = dbMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: m.content }],
      content: m.content,
    }));

    setInitialMessages(converted);
    setMessages(converted);
    setActiveSessionId(session.id);
  };

  // Start a new conversation
  const newConversation = () => {
    setMessages([]);
    setInitialMessages([]);
    setActiveSessionId(null);
    setInput("");
  };

  const submit = () => {
    if (!input.trim() || isLoading) return;
    setWorkflowPreview(null);
    sendMessage({ role: "user", parts: [{ type: "text", text: input }] });
    setInput("");
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen bg-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <span className="font-semibold text-zinc-800">FlowPilot</span>
          <button
            onClick={newConversation}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            + New
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-4 text-xs text-zinc-400">
              No conversations yet.
            </p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => loadSession(s)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  s.id === activeSessionId
                    ? "bg-zinc-100 text-zinc-900 font-medium"
                    : "text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                <p className="truncate">{s.title}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {new Date(s.updatedAt).toLocaleDateString()}
                </p>
              </button>
            ))
          )}
        </nav>
        <div className="border-t border-zinc-200 p-3">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100"
          >
            ⚙ Settings
          </button>
          <SettingsDrawer
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onSave={(key) => setApiKey(key)}
          />
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!hasMessages ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <p className="text-lg font-medium text-zinc-600">
                Describe a workflow to get started
              </p>
              <div className="flex gap-2 flex-wrap justify-center">
                {[
                  "List my workflows",
                  "Create a Slack alert",
                  "Trigger a webhook",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-xl rounded-2xl px-4 py-3 text-sm ${
                      m.role === "user"
                        ? "bg-zinc-200 text-zinc-800"
                        : "bg-white text-zinc-800 shadow-sm"
                    }`}
                  >
                    {m.parts.map((part, i) =>
                      part.type === "text" ? (
                        m.role === "assistant" ? (
                          <ReactMarkdown
                            key={i}
                            rehypePlugins={[rehypeHighlight]}
                          >
                            {stripPreviewMarker(part.text)}
                          </ReactMarkdown>
                        ) : (
                          <span key={i}>{part.text}</span>
                        )
                      ) : null,
                    )}
                  </div>
                </div>
              ))}

              {workflowPreview && (
                <div className="flex justify-start">
                  <WorkflowPreviewCard
                    preview={workflowPreview}
                    onConfirm={() => setWorkflowPreview(null)}
                    onEdit={() => {
                      const lastUserMessage = [...messages]
                        .reverse()
                        .find((m) => m.role === "user");
                      const text =
                        lastUserMessage?.parts.find((p) => p.type === "text")
                          ?.text ?? "";
                      setInput(text);
                      setWorkflowPreview(null);
                    }}
                  />
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-zinc-200 bg-white px-6 py-4">
          <div className="flex items-end gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask about your workflows..."
              className="flex-1 resize-none bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
            />
            <button
              onClick={submit}
              disabled={isLoading || !input.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? "..." : "Send"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">Cmd+Enter to send</p>
        </div>
      </main>
    </div>
  );
}
