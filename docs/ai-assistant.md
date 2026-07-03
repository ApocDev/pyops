# AI assistant

Code: `app/src/server/agent.ts` (config + system prompt + model resolution),
`app/src/server/agent-tools.server.ts` (the tools), `app/src/routes/api.chat.ts` (the
streaming chat route), `app/src/server/assistant-run-store.ts` (active run
replay), and `app/src/routes/mcp.ts` (the MCP surface).

A planning agent (Vercel AI SDK v6 → [OpenRouter](https://openrouter.ai), default
`~anthropic/claude-sonnet-latest`) drafts whole production chains over the Pyanodons
recipe data.

## Conversations (persistence)

Chats are saved **per-project** so you can leave one and resume it. The active
conversation lives in the URL (`/assistant?c=<id>`), so chats are linkable.

**Run continuity:** the live AI-SDK `Chat` instances live in an app-level store
(`app/src/lib/chat-store.ts`) **outside the React route tree**, one per
conversation. The backend also owns each run: `api.chat.ts` saves submitted
messages immediately, streams through a process-local replay buffer, and saves
the finished assistant message. Because the server keeps reading the stream after
a browser disconnect, runs keep going across in-app navigation and browser
reloads while the app process stays up. Reload recovery uses AI SDK `resume:
true` and `GET /api/chat?stream=<conversation-id>`; restarting `vp dev` clears
only the in-memory active-run buffer, not saved conversations.

In-progress runs are surfaced by the nav count, a pulsing dot next to each
running chat in the sidebar (resynced from the server), and an "Assistant is
working…" line in the chat itself. The Stop button is explicit cancellation: it
posts the latest partial assistant message to `/api/chat`, aborts the server-side
run, then stops the local stream. Route cleanup, tab close, and reload are treated
as disconnects, not cancellation.

A toolbar sits inside the message input box (below the textarea), holding the
context gauge (see Context compaction), a **model** pill, and a **reasoning**
pill, with the send button on the right. The model pill opens a popover with the
curated list + a custom-id field + make-default / clear; the reasoning pill opens
an Auto / Low / Medium / High menu (levels grey out on models that don't support
reasoning effort). When
`PYOPS_AGENT_MODEL` is unset, each conversation can override the app default with
a free-text OpenRouter model id or one of the curated choices. The override is
stored on the conversation, so branches can diverge by model. If
`PYOPS_AGENT_MODEL` is set, it remains a hard deployment override and the
per-chat picker is read-only.

Each conversation also stores an optional OpenRouter reasoning effort: model
default, low, medium, or high. The picker is enabled when the resolved model
advertises OpenRouter's `reasoning` parameter — detected live from the
`/api/v1/models` catalogue (`server/openrouter-models.ts`), with the static
`model-capabilities.ts` table as the offline fallback. When set, `api.chat.ts`
sends it as
`providerOptions.openrouter.reasoning.effort` with `exclude: false`; unsupported
or custom models stay on provider/model defaults and receive no reasoning effort
parameter. The transcript renders streamed reasoning parts as collapsed blocks.
Title generation does not display reasoning and asks known reasoning models for
low, excluded reasoning so they have budget to emit the short title without
wasting visible transcript space.

Message controls in the transcript support editing/resending a user message,
retrying an assistant answer, and branching a new conversation from any message.
Editing an earlier user message replaces it and retries from that point; branching
copies the transcript prefix into a new saved conversation and opens it.

## Context compaction

Compaction is anchored to **real token counts**, not a guess. Each completed turn
records OpenRouter's actual usage — the last tool-loop step's input+output (that
request carries the whole conversation, so it's the true context fill; the
aggregate `usage` sums every step's prompt and over-counts) — plus the concrete
model that served it, onto the conversation row (`last_*_tokens`, `last_model_id`).
Context windows come live from OpenRouter's `/api/v1/models` catalogue
(`server/openrouter-models.ts`, cached 6h, `~…-latest` aliases resolved to the
newest concrete model in the family); `lib/model-capabilities.ts` is only the
offline fallback. Before each turn, `api.chat.ts` compares the last real count
against the model's real window and falls back to a chars/4 estimate only when no
turn has completed yet — so we don't summarize (and shed detail) until the context
is genuinely close to full.

When usage reaches 75% of the window, the oldest prefix is summarized into one
synthetic `system` message and the newest turns stay verbatim. The summary is
generated with the selected model, using low excluded reasoning when the model
supports reasoning effort. If summarization fails or there is no API key, PyOps
falls back to a local extractive summary rather than dropping context.

The compacted transcript is saved back to the project database and used as the
AI-SDK `originalMessages` for the in-flight response, so browser reloads and the
finished assistant message both keep the compacted form. The summary message also
stores the replaced originals in an ignored `data-compaction` part; the UI renders
that as an "Earlier conversation summarized" block with a nested original-message
viewer. Only the text summary is sent back to the model.

**Context gauge.** The input toolbar shows a filling ring with the percent of the
context window used (green → amber → red), backed by `conversationTokenStatusFn`.
Clicking it force-compacts the conversation now (`compactConversationFn` →
`compactMessagesForContext(..., { force: true })`); the live client chat swaps to
the returned messages and the stale real-token count is cleared so the gauge
reflects the smaller compacted size until the next turn measures it for real.

Code: `db/conversations.server.ts` (queries, usage columns + `recordTurnUsage`, and an
idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` so existing project dbs
gain the tables/columns without a manual push), `server/conversations.ts` (server
fns incl. `generateTitleFn`, `conversationTokenStatusFn`, `compactConversationFn`,
active-run resync), `server/openrouter-models.ts` (live context windows + reasoning
support), `server/conversation-compaction.ts` (trigger + summarization),
`server/assistant-run-store.ts`, the client store (`compactChat`), and the gauge +
input-bar model/reasoning pills in `routes/assistant.tsx`. Message `parts` are stored as JSON
strings.

## Tools

The agent's tools are **read-only** wrappers over the query layer, plus a few
propose-then-apply write actions. They're the minimum surface needed to reason
about "how do I make X":

- **Fuzzy name resolution** — map a loose item/recipe name to a stable internal
  handle.
- **Recipe-candidate ranking** — find and rank the recipes that produce a good.
- **TURD choices** (`turdChoices`) — the full mutually-exclusive branch set of a
  TURD master (looked up by master, recipe, or good): each branch's description,
  the recipes it swaps (old→new) or newly **unlocks**, and its always-on modules.
  It walks the tech-prerequisite graph, so unlike `availableTurds`/`turdConsistency`
  (which key off recipe _replacements_) it also sees branches that grant a brand-new
  recipe. `recipeInfo.turd` returns the same full detail for every master touching a
  recipe. This is what the agent consults for "what does this TURD give / which
  branch is best" — never assume a master has a single choice.
- **Factory-wide coherence audit** (`coherenceAudit`,
  `app/src/server/coherence-audit.server.ts`, #11) — the cross-block balance in
  one call, reusing the Coherence page's wiring query: under-supplied goods
  (each with its producer blocks' ids + rates, so the agent can propose
  `reviseBlock` resizes), overproduced links, imports no block produces
  (with a craftable flag), and dangling byproducts. Each dangling byproduct
  carries a **disposal verdict**: `route` (productive consuming recipes exist),
  `void` (only a vent/void/incinerate disposal recipe), or `nowhere`
  (store/buffer — an open problem). The void classifier is data-driven (a
  recipe that consumes only the good and returns at most a fraction of it), so
  it matches Py's `*-pyvoid*` venting/sinkhole/incineration families without
  name-matching. `byproductSinks` uses the same classifier to list
  `voidOptions` separately from real consumers.
- **Additive/commodity classifier** (`app/src/server/additives.ts`) — decides
  whether an input should be _imported_ (a cross-cutting commodity like an acid,
  gas, or solvent — stop recursing) or _built_ (part of the target's own lineage —
  recurse into a sub-chain). The signal is fan-out ubiquity: in Py, commodities sit
  at 10s–100s of consumers while private intermediates sit at 1–2, so a simple
  threshold plus a short override list classifies the common case. Per-block user
  pins override it.
- **Draft-a-block** — assemble the reasoning into a reviewable single-block draft.
- **Revise-a-block** — propose changing an _existing_ block: RAISE/LOWER its
  output rate to meet new demand, and/or REPLACE its recipe set (#12 — e.g.
  swap to a higher-yield variant), instead of building a duplicate. A recipe
  revision re-solves the new set and returns the diff (recipes added/removed)
  plus any byproducts the block's current solve doesn't export
  (`newByproducts`), so closure damage is visible before the user applies.
- **Draft-a-plan** — assemble several solved block drafts for one request (and,
  optionally, resizes of existing blocks), then let the user apply all of them in
  one action.
- **Tasks** — `listTasks`/`getTask` read the user's planning to-do tree;
  `createTask` files one (with optional checklist steps and entity links);
  `updateTask`/`addTaskStep`/`linkTask` edit it. Unlike block drafts, these apply
  **directly** (low-stakes, reversible on the Tasks page), so the agent can file a
  follow-up after drafting — it's told to do so when the user agrees or asks what's
  left, checking `listTasks` first to avoid duplicates. A separate **Enhance**
  action on a task (`enrichTaskFn`, not an agent tool) rewrites a rough capture's
  title/body into something sharper while preserving the original intent.
- **Live game-world (read-only)** — `gameContext`, `gameInspectArea`,
  `gameFindEntities`, `gameProduction` query the _running_ factory through the
  bridge (app→mod→Factorio), so the agent can ground a task in real evidence
  ("what's built here", "is X actually being made"). Bounded and structured; they
  return a clear error when the companion mod isn't connected. Two lower-level
  tools back the same bridge for developer debugging (used primarily over MCP):
  `gameEval` runs a Lua chunk in the game for deeper reads (framed read-only by
  convention, not enforced — fine for a local single-player game), and
  `gameScreenshot` captures the game (GUI included) to a PNG path, optionally
  auto-cropped to a top-level GUI element (`panel`) or an explicit `crop`/`scale`
  — built for designing the in-game panel live (snap, look, tweak) without a
  Factorio reload.

Single-block drafts still use `submitBlock`. `reviseBlock` re-solves an existing
block (looked up by its `factoryBlocks` id) at a new rate and/or with a revised
recipe set and returns an amber **Resize/Revise block #N** card with an **Apply
update** button: rate-only changes apply through `setBlockRateFn`, recipe
revisions through `setBlockRecipesFn` (which swaps the doc's recipe list via
`lib/block-doc.ts` `withRecipeSet` — pruning removed recipes' machine/module/
pin config — then re-solves and persists). Multi-output requests or requests
for complete supporting production use `submitPlan`, which returns a plan card
with one preview per block, an optional **resize existing blocks** section, and a
**Create N blocks · resize M** action. Creating a plan saves each proposed block
through the normal block save path (solved flows, machine requirements, power,
cache) and applies each resize through `setBlockRateFn`, exactly like a manually
edited block. The agent is told to check each existing block's current
`makes[].rate` and resize rather than duplicate when it's too small.

When the user asks to include building materials, the agent is expected to add
support blocks for the items needed to build the chosen machines and logistics
along the way, not only the science/production recipe ingredients. That includes
things like steel, circuits, belts, inserters, pipes, assembling machines,
furnaces, labs, and Py equivalents when those are part of the selected chain.
Raw resources, electricity, and broad commodities remain imports unless the user
specifically asks to produce them too.

The same tool bodies back two front doors: the in-app agent and the MCP route
(`routes/mcp.ts`), which registers **every** tool in `agentTools` for external
MCP clients over `POST /mcp` (JSON-RPC). This lets an external agent — e.g.
Claude driving the _running game_ via the read-only game-world tools — exercise
and debug the integration directly, not just the in-app assistant. The handler
(`utils/mcp-handler.ts`) is single-shot per request and waits for the tool's
real async result (db / bridge / LLM), so slow tools work.

The repo ships project-scoped MCP client config for Codex (`.codex/config.toml`)
and Claude Code (`.mcp.json`). Both point at `http://localhost:3000/mcp`, so run
`vp dev` in `app/` before using the external tools. Claude Code marks the project
server pending until the user approves it in an interactive `claude` session.

## Planning horizon

Before each chat turn, `api.chat.ts` injects the current planning horizon into the
system prompt:

- **Now** — plan only with recipes the user can build right now (research
  enabled/available within their current science, TURD active or pickable).
- **Future** — any recipe is fair game, but the agent must call out what needs
  unlocking (which science packs) or which TURD path to select.

## Configuration

The key resolves **env → app-config**. The model resolves
**env → conversation override → app-config → default**:

- `OPENROUTER_API_KEY` env, **or** set it in **Settings → Assistant** (stored in
  `app-config.json`, app-level). Missing everywhere → the assistant returns a 500
  pointing at both.
- `PYOPS_AGENT_MODEL` env, **or** the active conversation's model, **or** the
  model field in **Settings → Assistant**, else `DEFAULT_MODEL`. Any OpenRouter
  id. Env wins when set; the per-conversation picker is for interactive local use
  when env is unset.
- Per-conversation reasoning effort is optional and applies only to OpenRouter
  calls for the active chat when the resolved model is in the known reasoning
  model list. Leave it on model default for provider/model routing defaults;
  choose low/medium/high when a supported reasoning model needs an explicit
  effort.

Resolution lives in `server/app-config.server.ts` (`resolveApiKey` / `resolveModel`).

The agent runs a bounded tool loop (`MAX_STEPS`, currently 60) — drafting a full Py
chain takes many calls.
