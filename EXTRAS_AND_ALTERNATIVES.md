# FlowPilot — Extras & Alternatives

> Decisions made during implementation that deviate from, extend, or replace what the original user stories specified.

---

## US-03: Workflow Preview Before Creation

### Alternative: Text-marker streaming instead of SSE data events

**Original spec said:**
> Agent emits a structured JSON event `{ type: 'workflow_preview', payload: {...} }` via the SSE stream. Client SSE handler detects `type=workflow_preview` and renders the `WorkflowPreviewCard`.

**What we implemented instead:**
The AI outputs a plain-text marker block inside its normal text stream:

```
<<<WORKFLOW_PREVIEW>>>
{ "name": "...", "nodeCount": 3, "json": {...} }
<<<END_WORKFLOW_PREVIEW>>>
```

The frontend detects this via a regex in a `useEffect`, extracts the JSON, and strips the block from the displayed text.

**Why:**
`createDataStreamResponse` (the SDK function needed for structured SSE data events) is not exported by `ai` v6. The correct v6 replacement (`createUIMessageStream` + `UIMessageStreamWriter`) requires pre-declaring custom data types in TypeScript, adding significant boilerplate for no practical UX difference at this stage.

**Trade-offs:**
- Simpler to implement and easier to understand
- Slightly more fragile — relies on the LLM consistently following the marker format
- Revisit when MCP tools are wired up (the agent will then have a proper `create_workflow` tool call that can trigger the preview more reliably)

---

### Alternative: Custom JSON viewer instead of `react-json-view`

**Original spec said:**
> JSON viewer: `react-json-view` (or custom) limited to 300px height with overflow-y scroll.

**What we implemented:**
A custom `<pre>` block with a show/hide toggle — no third-party library.

**Why:**
Fewer dependencies, zero configuration, and the user can read every line of code. The spec explicitly listed "or custom" as an option.

---

## Cost Optimisation (not in any user story)

This entire system was added proactively. None of it appears in the 22 user stories.

### Three-tier intent routing

```
Tier 1 — Haiku   → list, show, get, check, status, history, credentials
Tier 2 — Sonnet  → debug, diagnose, fix, why, failing, error, inspect
Tier 3 — Sonnet  → create, build, make, design, generate, new workflow
```

Implemented as a `classifyIntent()` function in `route.ts`. Zero latency, zero extra API calls — pure keyword matching.

**Estimated saving:** ~50–60% of queries hit Haiku, which is ~15× cheaper than Sonnet per token.

---

### Prompt caching

The system prompt is marked with Anthropic's `cache_control: { type: "ephemeral" }` via the `providerOptions` field on `SystemModelMessage`.

```ts
system: {
  role: "system",
  content: SYSTEM_PROMPT,
  providerOptions: {
    anthropic: { cacheControl: { type: "ephemeral" } },
  },
},
```

Cache TTL is 5 minutes. Cache hits are billed at 25% of normal input token price.

**Estimated saving:** System prompt is ~300–500 tokens. With many requests per session, this cuts input costs by 40–50% on the prompt portion.

---

### Context pruning

Only the last 10 messages are sent to the model per request:

```ts
messages: await convertToModelMessages(messages.slice(-10)),
```

Full history is still persisted in PostgreSQL and shown in the UI — the truncation is only applied to the LLM payload.

**Why 10:** Enough for the model to maintain conversational context; prevents token costs from growing linearly with session length.

---

## Provider Decision (not specified in original spec)

**Original spec:** Stack listed as TypeScript · MCP SDK · Next.js 15 · n8n · PostgreSQL · Prisma · Docker · Nginx · Hetzner. No LLM provider was specified.

**What we chose:** Anthropic Claude models (`claude-haiku-4-5-20251001` and `claude-sonnet-4-6`) via `@ai-sdk/anthropic`.

**Why:**
- Claude Sonnet is significantly stronger at code generation and structured JSON output — both critical for workflow creation (US-08)
- Anthropic's prompt caching feature provides direct cost savings not available with OpenAI at the same granularity
- The AI SDK (`@ai-sdk/anthropic`) provides the same interface as `@ai-sdk/openai`, so the switch required minimal code changes

**What was removed:** `@ai-sdk/openai` dependency and `openai()` model references.
