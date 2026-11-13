---
title: AI assistant
description: Understand Assistant persistence, streaming runs, provider and model resolution, context compaction, tool trust levels, proposals, live-game access, and MCP reuse.
outline: [2, 3]
---

# AI assistant

The PyOps Assistant is a project-aware planning agent built with AI SDK. It talks to
OpenRouter or to any OpenAI-compatible endpoint, such as a LiteLLM gateway. It combines a planning system prompt with structured tools over the same queries, solvers, and
bridge used by the application.

The principal boundaries are:

- `app/src/server/agent.ts` — provider and model creation, system prompt, reasoning
  options, turn cost, and tool-loop limit;
- `app/src/server/app-config.server.ts` — provider, connection, and model precedence;
- `app/src/server/model-catalog.server.ts` — model metadata for the active provider;
- `app/src/server/agent-tools.server.ts` — shared tool definitions and trust tiers;
- `app/src/routes/api.chat.ts` — conversation synchronization and streaming run lifecycle;
- `app/src/db/conversations.server.ts` — per-project conversation persistence;
- `app/src/server/assistant-run-store.ts` — process-local stream replay and cancellation;
- `app/src/server/conversation-compaction.ts` — context measurement and summarization;
- `app/src/routes/mcp.ts` — external MCP exposure of the shared tools.

For API-key setup, model selection, privacy, cost expectations, and end-user workflows, see
[Use the Assistant](../guide/assistant).

## Request lifecycle

`POST /api/chat` owns one complete turn:

1. Validate the conversation ID, then check that the active provider is configured for
   it (`providerProblem()` with the conversation's own model pick).
2. Persist the submitted UI messages immediately.
3. Load the per-conversation model, reasoning effort, usage, and stored transcript.
4. Compact older context when required.
5. Start a process-owned replayable run with an abort signal.
6. Inject the active planning horizon, and the page the message was sent from, into the
   system prompt.
7. Call `streamText()` with `agentTools` and a bounded step count.
8. Stream UI-message events to the client and replay buffer.
9. Record the final step's real token usage, the concrete model ID, and the turn's cost.
10. Persist the finished assistant message and generate a title for the first completed
    exchange.

The tool loop is bounded by `MAX_STEPS`. Full Py chains may require many structured calls,
but a model cannot continue indefinitely.

The route converts stored message parts back into AI SDK `UIMessage` values. Tool inputs,
outputs, text, reasoning, proposal data, and compaction metadata therefore survive a reload
without inventing a second transcript format.

## Conversation persistence

Conversations and messages live in the active project's SQLite database. Switching projects
changes the available chats together with blocks, tasks, notes, and reference data.

The active conversation ID is a URL search parameter, making a chat directly addressable.
Model and reasoning selections are stored on the conversation, so a branch can diverge from
the app default without modifying its parent.

### Client ownership

AI SDK `Chat` instances live in `app/src/lib/chat-store.ts`, outside the Assistant route
component. Navigating to Factory or another page does not unmount the active client run.
The store reports each conversation's generating state to `app/src/lib/chat-runs.ts`, which
the global run count and per-conversation indicators read. Global chrome imports only
`chat-runs.ts`, so the AI SDK and the transcript UI load with the Assistant page or the
dock, not with every page.

The transcript, composer, and proposal cards are one component,
`app/src/components/assistant/chat-view.tsx`. The Assistant page and the dock both render
its `ChatPane`. An unsent draft (the input text and any message being edited) is kept per
conversation in the chat store, so closing the dock or opening the chat on the full page
keeps it.

Editing a user message truncates and retries from that point. Retrying an assistant message
reuses the preceding transcript. Branching copies the selected prefix into a new persisted
conversation with its own model and reasoning settings.

### Server-owned run continuity

`assistant-run-store.ts` keeps the active stream, accumulated chunks, subscribers, and abort
controller in server-process memory. The server continues consuming an AI response after a
browser disconnect.

`GET /api/chat?stream=<conversation-id>` replays buffered chunks and then subscribes to the
live stream. This supports route navigation and browser reload while the server process
remains alive.

A server restart removes active replay buffers but leaves persisted messages untouched.
Disconnect is not cancellation. The explicit Stop action aborts the model request, saves
the latest partial assistant message when supplied, closes subscribers, and removes the
run.

Starting a new run for the same conversation aborts and replaces any previous active run,
preventing concurrent writers from interleaving one transcript.

## Provider and model resolution

PyOps has two providers. `openrouter` uses the OpenRouter AI SDK provider.
`openai-compatible` uses `@ai-sdk/openai-compatible` against any server that implements the
OpenAI Chat Completions API. LiteLLM is the main target, but nothing in the request path is
LiteLLM-specific. Configuration resolves in these orders:

```text
Provider:   PYOPS_AI_PROVIDER → stored provider → openrouter
OpenRouter: OPENROUTER_API_KEY → stored key
Endpoint:   PYOPS_OPENAI_COMPATIBLE_BASE_URL → stored URL
            PYOPS_OPENAI_COMPATIBLE_API_KEY → stored key (optional)
Model:      PYOPS_AGENT_MODEL → conversation override → active provider's stored default
            → built-in default (OpenRouter only)
```

`PYOPS_AGENT_MODEL` is a deployment override. When present, conversation-level model
controls cannot affect the request. The OpenRouter built-in default is the curated
`~anthropic/claude-sonnet-latest` alias. An OpenAI-compatible endpoint has no universal
default, so the stored model (`openaiCompatibleModel`) is required there. Each provider
keeps its own stored default, so switching back and forth doesn't carry an OpenRouter alias
to a gateway that would reject it.

`app/src/server/app-config.server.ts` owns precedence. Its pure `…From(env, stored)`
functions take the environment and stored config as arguments, which keeps them testable.
`providerProblem(modelOverride)` returns a user-facing message naming the missing key,
URL, or model, or null when the provider is ready. A conversation's own model pick
satisfies the model requirement, so a chat can run on an endpoint without a stored default.
The chat route, the input-bar warning, title generation, compaction, and task helpers all
check it before calling a model.

`getModel(modelOverride, sessionId)` in `agent.ts` builds a fresh provider model per call. In
OpenAI-compatible mode it:

- sends the key as a bearer token when one is set;
- adds `x-ai-app: pyops` to every request, and `x-ai-session: <conversation id>` when the
  call belongs to a conversation (chat turns, titles, and compaction), so a gateway can
  attribute usage;
- sets `stream_options.include_usage` so streamed responses carry token counts;
- reads `usage.cost` from the response through the provider's `metadataExtractor`.

### Model metadata

`app/src/server/model-catalog.server.ts` answers context window, reasoning support, effort
levels, and the picker's model list for whichever provider is active. Callers never branch on
the provider.

For OpenRouter, `app/src/server/openrouter-models.ts` loads OpenRouter's public model
catalog and caches it for six hours. It records:

- context-window size;
- whether the model advertises reasoning parameters;
- supported reasoning-effort values;
- concrete family members used to resolve `~…-latest` aliases.

The curated table in `app/src/lib/model-capabilities.ts` is an offline fallback, not the
primary source when the catalog is available.

For an OpenAI-compatible endpoint, `app/src/server/openai-compatible-models.ts` reads
`GET /models` and, when the server answers it, LiteLLM's `GET /model/info`. It caches the
result per base URL and key for ten minutes, and waits 30 seconds before retrying a failed
fetch. LiteLLM adds `max_input_tokens` and `mode` to `/models`; non-chat entries (image,
audio, embedding) are dropped. `/model/info` adds `supports_reasoning` and the accepted
OpenAI parameters. A plain server returns only IDs. Then the context window is `null`, the
gauge shows a token count without a percentage, compaction falls back to the
`FALLBACK_CONTEXT_WINDOW` threshold, and reasoning effort is not offered.

### Reasoning effort

A conversation may store low, medium, or high reasoning effort. `reasoningProviderOptions()`
normalizes the selection and sends it only when the resolved model advertises support:
as OpenRouter's `reasoning.effort` option, or as the `reasoning_effort` request parameter on
an OpenAI-compatible endpoint. Unsupported and unknown models receive no forced effort.

Reasoning parts remain in the stored AI SDK message and render as collapsed transcript
sections. Background title generation and compaction use low reasoning effort on
compatible models so their budget goes toward concise visible output. On OpenRouter they
also exclude the reasoning text from the response.

## Planning-horizon injection

Before each turn, `api.chat.ts` reads the active project's research horizon and appends a
mode-specific contract to the system prompt:

- **Now** restricts recipes to what the synchronized or manually entered research state can
  build, and treats an unselected TURD branch as advice rather than permission.
- **Up to target** allows only recipes reachable by the target technology and directs the
  agent to choose within that boundary.
- **Future** allows the complete synced data while requiring research and TURD gates to be
  identified.

This prompt context guides tool use, but availability fields returned by recipe tools remain
the authoritative evidence. Tool results distinguish research reachability, buildability,
active/pickable/blocked TURD state, and machine availability.

## Assistant dock and page context

The dock is the same chat beside any page. `AssistantDockHost`, mounted in the root layout,
owns the <kbd>Ctrl</kbd>/<kbd>Command</kbd>+<kbd>.</kbd> hotkey and the frame: a 440px
column from the `lg` breakpoint up, and below that a modal sheet: a
right-hand panel on tablets, full screen on phones. The sheet holds focus while open and
returns it to the Ask button on close, since it covers the page. It lazy-loads `components/assistant/assistant-dock.tsx` on first open. Open state
and the shown conversation live in `app/src/lib/assistant-dock.ts`.

Pages offer their focused entity through `usePageEntity()` in `app/src/lib/page-context.ts`:
the block editor, the Explore selection, the most recently expanded TURD master, and the
selected task. The entity's `id` is what the tools take: a block or task ID, or a good's or
tech's internal name.

A dock send adds a `data-page-context` part to the user message holding the route, the page
name, and the entity unless the user removed its chip. The part is stored with the
transcript and renders as the "asked from" tag. Model-message conversion drops data parts,
so the record never appears as user text. Instead, `pageContextNote()` in
`app/src/server/page-context-note.ts` reads the latest user message's part, and the chat
route appends it to the system prompt after the planning-horizon note. The note says the
context is advisory. Messages sent from the full Assistant page carry no part and get no
note.

The part comes from the client, and block and task names can come from someone else's
shared block or backup. So `pageContextNote()` validates it first: a known entity kind, a
numeric or internal-name ID, and a route on the app's own list. It names the page from that
list and the entity by kind and ID. The label goes in only as single-line, length-capped
data in «…» quotes. A malformed part adds no note.

The dock can sit beside the block a proposal changes, and navigating to an open block
doesn't remount its editor. Applying a block revision or plan therefore calls
`syncChangedBlocks()` from `app/src/lib/undo-client.ts`, the same path undo uses: it
hydrates each changed block's open editor with the saved doc, so the editor's auto-save
can't write the old doc back, and refreshes the planning queries.

## Context measurement and compaction

Each completed turn stores the concrete model ID, the last tool-loop step's input and
output token counts, and the turn's cost (`last_cost_usd`). Aggregate AI SDK usage sums every step's prompt and therefore
overstates how full the context window was; the final step carried the complete current
conversation and is the relevant measurement.

Before a turn, `compactMessagesForContext()` resolves the serving model's context window
and chooses its measurement source:

1. real tokens from the previous completed turn;
2. otherwise a conservative character-based estimate.

Automatic compaction starts at 75 percent of the context window. It summarizes an older
prefix, keeps at least the newest eight messages verbatim, and targets a remaining estimate
below 55 percent. Very short conversations are not compacted even when forced.

### Turn cost

`turnCost()` in `agent.ts` sums each step's cost, because every tool-loop step is a billed
request. OpenRouter reports cost in its provider metadata. An OpenAI-compatible response
carries it as `usage.cost` when the server sends one; LiteLLM passes OpenRouter's value
through. If any step lacks a cost, the turn's cost is `null`, meaning unknown, never 0.
LiteLLM's `x-litellm-response-cost` header is not used because streamed responses send
headers before the cost is known.

### Summary persistence

The selected model summarizes the prefix with instructions to preserve goals, decisions,
tool evidence, unresolved work, and commitments. If model summarization is unavailable or
fails, a local extractive summary prevents the request from losing all earlier context.

The result is one synthetic system message followed by recent messages. Its visible text is
sent to subsequent model calls. AI SDK rejects system messages inside `messages` by default,
so the chat route sets `allowSystemInMessages` to accept this stored summary. A separate
`data-compaction` part archives the replaced original messages for the UI's expandable
history viewer and is ignored by model-message conversion.

The compacted transcript is saved before the in-flight generation begins, so resumed runs
and later turns use the same context.

### Context gauge

`conversationTokenStatusFn` returns used tokens, context limit (or `null` when unknown),
model, the last turn's cost, and whether the value is measured or estimated. The input
toolbar renders that as a filling ring labeled "N% context", or "N tokens" when the limit is
unknown. Its tooltip shows the last turn's cost or says it is unknown.

Manual compaction calls the same implementation with `force: true`, replaces the client
chat with the persisted result, and clears the stale real-token measurement until the next
turn records a new one.

## Tool architecture

Every tool is an AI SDK `tool()` with a Zod input schema, a detailed behavioral contract,
and an async executor. Tools call query and planning modules rather than duplicating SQL or
solver logic.

`agentTools` is grouped by trust and side effect.

### Project reads

Read-only tools resolve names and inspect the current project:

| Area                       | Representative tools                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Goods and recipes          | `searchGoods`, `recipeGraph`, `recipeOptionsBatch`, `recipeInfo`, `goodInfo`, `calcRecipe` |
| Blocks and closure         | `factoryBlocks`, `chainStatus`, `byproductSinks`, `coherenceAudit`, `whatIf`               |
| Research and TURD          | `researchPath`, `turdChoices`, `availableTurds`, `turdConsistency`                         |
| Construction and operation | `buildingBill`, `logisticsFor`, `factoryPower`, `blockBuildStatus`, `productionStats`      |
| Work context               | `listTasks`, `getTask`, `listNotes`                                                        |

These results use stable internal names for follow-up calls while including localized
display names for model output. Availability, favorite/default machine selection, module
fill, productivity, factory balance, and logistics reuse the same application functions as
the UI.

High-level batch tools are preferred over repeated narrow calls. For example, `recipeGraph`
provides a bounded production neighborhood, `recipeOptionsBatch` expands several seams at
once, and `coherenceAudit` reports cross-block balance in one request. This reduces cost and
keeps one answer internally consistent.

### Proposal tools

`submitBlock`, `reviseBlock`, and `submitPlan` are named as planning submissions but do not
persist changes. They solve and return typed proposal data for dedicated chat cards.

A block draft can contain:

- multiple throughput or keep-in-stock goals;
- selected recipes, machines, fuels, modules, and beacons;
- solved building counts, imports, byproducts, power, heat, and pollution;
- TURD requirements and conflicts;
- suggested supporting blocks and notes.

The draft path shares module-fill and compute logic with the block editor. `buildingBill`
uses the same fill pass before rounding whole machine items, so construction estimates and
draft building counts agree.

Proposal cards provide explicit create or apply actions. The React handlers use normal
block server functions and persistence paths, preserving solve caches, snapshots, undo,
conflict handling, and full goal definitions. Multi-block plan application groups its block
creation and requested existing-block updates into one reviewable operation.

After creation, a card can send the saved block through the ordinary bridge summary command.
Follow-up chips turn suggested supplier blocks or byproduct routing into a new user message;
they do not apply hidden planning work.

### Direct task writes

Task tools can create or update tasks, steps, and links directly. They are lower-risk,
reversible project records intended to capture agreed follow-up work. Tool guidance requires
checking existing tasks and avoiding unsolicited duplicates.

Notes remain read-only to the Assistant. They are treated as user-authored planning context
rather than another agent-managed task surface.

### Live-game reads

`gameContext`, `gameInspectArea`, `gameFindEntities`, and `gameProduction` perform bounded,
structured queries through the connected Companion mod. They fail clearly when no peer is
available.

Persisted `productionStats` and `blockBuildStatus` are separate offline tools. They read the
last full synchronized snapshots and return timestamps so the model can distinguish stale
evidence from a live result.

### Lua proposal boundary

The in-app `gameEval` tool does not execute Lua. It returns the exact snippet and note as a
proposal card. Only the card's **Run in game** action sends `cmd.eval`; the result is rendered
separately and can be shared into a later Assistant message.

The Companion mod independently checks its **Allow app-driven Lua eval** setting. This
protects every eval sender even if a UI path is bypassed.

Structured tools remain preferred for project data and common game inspection. Eval is for
a narrowly scoped live value the bridge does not expose or an explicit user-requested game
mutation.

## Planning behavior encoded in tools and prompt

The system prompt defines planning policy while tools provide evidence and calculations.
Important boundaries include:

- choose recipes deliberately; intrinsic cost is comparison evidence, not an automatic
  tier selector;
- reuse and resize existing supplier blocks before proposing duplicates;
- cut blocks at shared commodities and substantial reusable intermediates, while keeping
  private or fast-spoiling chains local;
- route every byproduct to a consumer, disposal recipe, or explicit storage problem;
- treat electricity as grid-wide, heat as local, and fluid-fuel energy as a matchable
  block-to-block good;
- use stock goals for mall and building supplies that have no honest continuous rate;
- audit TURD consistency across the whole plan;
- propose a complete multi-block plan in one card rather than persisting partial work.

Keep these rules in the system prompt when they guide model judgment. Put deterministic
facts—availability, rates, classification, solver output, and conflicts—in tool results.

## MCP surface

`POST /mcp` exposes the same tool implementations to external MCP clients. The route builds
one `McpServer`, registers each AI SDK tool's description and Zod shape, and waits for the
real async result before returning JSON text content.

`mcpTools` extends the in-app set:

- it replaces proposed `gameEval` with a direct-executing developer variant;
- `gameScreenshot` captures and optionally crops the running game;
- `gameReloadMods` drives the bridge-aware reload loop;
- `gameShowBlock` and `gameCloseSummary` control the in-game summary for visual testing.

These tools are deliberately excluded from the in-app Assistant. A chat model cannot consume
a local screenshot path, and ordinary planning should not reload mods or drive debug UI.

Project-scoped client configuration points to `http://localhost:3000/mcp`. The development
server and any required Companion-mod connection must be running before live tools can
succeed.

::: warning MCP changes the approval boundary
The direct MCP eval tool has no Assistant proposal card. The external MCP client and user
own approval and trust for that connection. Keep the endpoint local and use the Companion
mod's eval setting as defense in depth.
:::

## Privacy and data boundaries

Project reads and tool outputs selected by the model become part of the request context sent
to the configured provider. Provider keys, the endpoint URL, and default models live in app
configuration, while conversation transcripts live in the project database. The settings
server function reports only whether a key is set, never its value.

The Assistant does not receive the whole database automatically. It sees the system prompt,
conversation messages, and results of tools it calls. Tool contracts should return the
minimum bounded data required for planning rather than unbounded tables or map dumps.

Live-game inspection remains local until its structured result is included in the model
conversation. Screenshot tools are MCP-only and return local paths; the in-app model does
not upload them.

## Adding or changing a tool

1. Put server-only execution in `agent-tools.server.ts` or a focused server module.
2. Define a strict Zod input schema and a description that states when to call the tool,
   what its result means, and what it must not be used for.
3. Reuse query, solver, effects, and bridge owners instead of reconstructing their logic.
4. Bound lists and expensive traversals; include timestamps or truncation metadata when the
   result can be partial or stale.
5. Classify the side effect: read, proposal, reversible project write, approved game action,
   or developer-only action.
6. Register it in `agentTools`, `mcpTools`, or both according to that trust boundary.
7. Add focused executor tests and update the system prompt only when the model needs new
   judgment guidance.
8. Verify the rendered tool result and any proposal/apply UI through the real Assistant
   flow.

Do not expose a direct block mutation merely because the executor exists. User-visible
planning changes belong behind proposal cards and explicit application.

## Verification

Assistant changes should cover the narrow owner and the streamed integration:

- config resolution tests (`app-config.server.test.ts`) and provider tests
  (`agent-provider.test.ts`, which checks the exact HTTP request an OpenAI-compatible
  endpoint receives);
- conversation database tests for persistence, model/reasoning fields, branching, and usage;
- compaction tests for thresholds, preserved recent turns, fallback summaries, and archived
  originals;
- tool tests for schemas, result semantics, availability, solver agreement, and bounded
  failure cases;
- proposal component tests for review and apply behavior;
- bridge tests for live-game tools and eval approval;
- API/E2E coverage for streaming, stop, reload/resume, model overrides, and project
  switching.

Run `vp test` and `vp check`. Live verification against OpenRouter or a gateway should use a
bounded prompt, a cheap model, and a dedicated key, while deterministic tool behavior
remains covered without model calls.
