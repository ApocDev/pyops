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
  Each candidate's `machine` names the building a draft would ACTUALLY solve
  with: the user's stored category favorite (`q.getFavoriteMachines`, the
  building-picker star), else the same low-tier `pickDefaultMachine` fallback
  `computeBlock`/`recipeDefaultsFn` use — never just "the fastest" (#130). Its
  availability note ("needs `<tech>`") is judged against that resolved machine,
  since that's what actually gates the draft. `fastestMachine` is surfaced
  separately, and only when a tier exists that's **strictly faster**
  (`craftingSpeed` greater, not just a different name) than the resolved pick —
  a same-speed tier tie must not be misreported as an upgrade — so the
  tier ladder stays visible without misattributing the availability gate. When
  the research horizon isn't `future`, the favorite/fallback pool itself is
  first restricted to machines the horizon already reaches (`availableNow`) —
  the same restriction `computeBlock`/`recipeDefaultsFn` apply — so a locked
  favorite falls through to the unlocked fallback instead of naming an
  unbuildable machine (#130).
- **TURD choices** (`turdChoices`) — the full mutually-exclusive branch set of a
  TURD master (looked up by master, recipe, or good): each branch's description,
  the recipes it swaps (old→new) or newly **unlocks**, and its always-on modules.
  It walks the tech-prerequisite graph, so unlike `availableTurds`/`turdConsistency`
  (which key off recipe _replacements_) it also sees branches that grant a brand-new
  recipe. `recipeInfo.turd` returns the same full detail for every master touching a
  recipe. This is what the agent consults for "what does this TURD give / which
  branch is best" — never assume a master has a single choice.
- **Research path** (`researchPath`, `app/src/db/queries.server.ts` `researchPath`/
  `orderTechSteps`/`rankUnlockTechs`) — given a target (a technology, a recipe, or
  an item/fluid good — resolved in that priority), returns the **not-yet-researched**
  prerequisite closure in **dependency order** (prerequisites first, the tech that
  actually unlocks the target last), each step with its own science-pack cost, plus
  `totalCost` summed across the WHOLE path. It always reads the REAL
  researched-tech state synced from the connected save (or marked manually in
  Settings) — independent of the current planning-horizon mode, which governs
  recipe *availability*, not what's already done. `alreadyUnlocked` means the
  target is already covered: either start-enabled (the static column), OR
  already covered by that synced researched-tech state — e.g. a recipe whose
  `enabled` column hasn't caught up, or a technology target itself already
  researched — checked up front, not only inside the step-ordering walk, so a
  target you already have never comes back with a nonsensical zero-step
  "route". A recipe/good reachable by more than one tech reports the
  cheapest (lowest-tier) route as `targetTech` and the others as `alternateRoutes`
  (name only — call the tool again with one of those to expand it). Pyanodons'
  `turd-select-*` gate technologies (a TURD branch pick, not a science action —
  verified zero cost, zero prerequisites of their own) are excluded from the
  step list and instead surfaced in `turdGatesNeeded` when the branch isn't
  already selected (`pickable` = master undecided; `blocked` = a different
  branch is already chosen, needing a respec) — same non-committal framing as
  `availableTurds`/`turdConsistency`. The tool's `limit` (default 40) bounds
  the `steps` list to the entries closest to the target, dropping the earliest/
  most-foundational ones first and reporting the drop count in `stepsOmitted`
  — `totalCost` always sums the whole path regardless, so the reported total
  stays correct even when a deep, mostly-unresearched target's closure runs
  into the hundreds of techs. This is the natural companion to
  TARGET-mode plans: state the research route ("research `electronics` →
  `battery-mk01`, ~40 `py-science-pack-1` total") instead of just naming gating
  packs.
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
- **Factory-wide demand-override simulation** (`whatIf`,
  `app/src/server/factory-solve.server.ts`'s `factoryWhatIf`, #127) — the
  same LP the What-if page (`routes/whatif.tsx`) uses, exposed as a tool:
  given one or more `{good, rate}` overrides, it treats every block as a
  fixed-ratio super-recipe and solves for the scale factor each needs,
  reporting `blocksToResize` (every block whose rate changes, INCLUDING the
  ripple through upstream feeder blocks, each entry's `blockId`+`rate` ready
  to pass straight into `reviseBlock`/a `submitPlan` `updates` entry),
  `rawsNeeded` (external draw current vs. projected), and `overproduced`
  (byproduct surplus the ripple creates, with an `absorb` hint naming an
  existing sink block when one exists). Because the underlying solver only
  honors an override on a good classified as a `demand` (a primary output
  nothing else consumes — see the module's `classify` helper), overriding a
  good another block still consumes is a silent no-op in the LP; the tool
  detects this (the good is absent from the solved `demands` list) and
  surfaces it in `ignoredOverrides` rather than returning a misleadingly
  unchanged result. Report-only, like the page it mirrors — it never writes;
  the agent still has to call `reviseBlock`/`submitPlan` to apply anything.
- **Additive/commodity classifier** (`app/src/server/additives.ts`) — decides
  whether an input should be _imported_ (a cross-cutting commodity like an acid,
  gas, or solvent — stop recursing) or _built_ (part of the target's own lineage —
  recurse into a sub-chain). The signal is fan-out ubiquity: in Py, commodities sit
  at 10s–100s of consumers while private intermediates sit at 1–2, so a simple
  threshold plus a short override list classifies the common case. Per-block user
  pins override it.
- **Draft-a-block** — assemble the reasoning into a reviewable single-block draft.
- **Multi-goal + keep-in-stock goals** (#38) — `blockDraftInput` (shared by
  `submitBlock`'s and `submitPlan`'s blocks) accepts either the legacy single
  `target`+`rate` shorthand or a `goals` array of `{ name, rate? , stock?,
  window? }`: each goal is EITHER a throughput `rate` OR a keep-in-stock
  `stock` amount (+ optional refill `window` seconds, default 600 —
  `STOCK_WINDOW_DEFAULT` in `lib/goals.ts`). A stock goal's solver rate is
  DERIVED as `stock/window` (`resolveGoals` in `agent-tools.server.ts`) — a
  buffer-refill rate, never a fabricated continuous one — which is the correct
  primitive for a construction/mall block ("keep 80 vrauks-paddock on hand")
  that has no honest per-second production rate. `goals[0]` (or the legacy
  `target`) still anchors the block's naming/sizing and the draft's
  `target`/`rate`/`targetDisplay` fields, so existing UI/back-compat code that
  only reads those keeps working; the draft's new `goals` array is what the
  apply path (`routes/assistant.tsx`) actually persists into `BlockData.goals`,
  stock/window included. `buildingBillBlockInput` accepts the same `goals`
  shape, so a mall block's several stock goals are all reflected in its machine
  bill too. `reviseBlockInput` stays rate/recipes-only by design (#38 scoped
  down): `rate` re-rates only the block's anchor goal, and `buildBlockUpdate`
  preserves the rest of its stored `goals` — including any stock ones — via
  `withPrimaryRate` (`lib/goals.ts`) rather than collapsing the block to a
  single goal.
- **Revise-a-block** — propose changing an _existing_ block: RAISE/LOWER its
  output rate to meet new demand, and/or REPLACE its recipe set (#12 — e.g.
  swap to a higher-yield variant), instead of building a duplicate. A recipe
  revision re-solves the new set and returns the diff (recipes added/removed)
  plus any byproducts the block's current solve doesn't export
  (`newByproducts`), so closure damage is visible before the user applies.
- **Draft-a-plan** — assemble several solved block drafts for one request (and,
  optionally, resizes of existing blocks), then let the user apply all of them in
  one action. When a block is a building/mall-supply block, the system prompt
  steers the agent to give it keep-in-stock goals (seeded from `buildingBill`'s
  machine `count`) instead of a fabricated rate, and to recurse into each
  machine's own intermediates as further blocks/plan entries.
- **Solved building counts, module-filled and shared** — `submitBlock`/
  `reviseBlock`/`submitPlan` no longer discard the machine counts `computeBlock`
  already solves: every draft carries a `buildings` field, `{ recipe, machine,
  count }[]` (fractional, module/TURD-beacon effects folded in — the same
  counts the block editor shows). The two-pass solve that fills each row's
  module slots with `computeBlock`'s own suggestions (adopt → re-solve) is
  factored into one shared helper, `solveWithModuleFill` — used by BOTH the
  block-draft path AND `buildingBill`, so the two tools' counts always AGREE
  for the same recipes. Before this fix `buildingBill` ran a bare
  `computeBlock({ goals, recipes })` with no module pass, which for Py's
  creature/farm buildings (intentionally near-useless unmoduled — vrauks
  paddocks, tree farms) inflated its reported count by roughly 10-15× versus
  the same block's `submitBlock` draft. **`buildingBill`** is the cross-block
  machine BILL for "include the buildings needed to build this": given the
  same `{ target, rate, recipes }[]` shape as `submitPlan`'s blocks (or the
  `goals` array, see above), it solves each independently with the shared
  module fill (a failing block is skipped into `skipped`, not a hard error),
  CEILS each block's per-recipe machine count to a whole building, then sums by
  machine entity across every block. Each machine entity is mapped to the ITEM
  that places it (`q.getItem(entity)`; Factorio's convention is entity name ==
  item name — there's no separate `place_result` column in the schema, so
  `item` comes back `null` with a note if no matching item prototype exists)
  and given its top 1–2 producing recipes (`optionsFor`, the same shape
  `recipeOptions` uses). Belts/inserters/logistics are deliberately out of
  scope — machine items only. The agent is told to call this once a plan's
  blocks are chosen, then decide per machine item whether an existing mall
  block supplies it, an existing block should be resized (`reviseBlock`/plan
  `updates`), or it needs its own new block, sized with a keep-in-stock goal.
- **Factory-wide power rollup** (`factoryPower`, #129) — total electric DEMAND
  vs GENERATION across every enabled block, in one call. Demand reuses each
  block's cached `electricityW` (the same figure the Factory page's header
  totals — no re-solve). Generation reads the `pyops-electricity` pseudo-good's
  PRODUCER-end flow (`block_flows` role `primary`/`stock`/`byproduct`, never
  `import`) already recorded from each block's last real solve — a block whose
  recipes include a `kind: "generating"` recipe (turbine, generator, solar
  panel, burner-generator, …) nets a positive export there, so a "power block"
  is identified with no new convention. Returns `totalDemandW`/
  `totalGenerationW`/`netW` plus `topConsumers` (top `limit` blocks by draw)
  and `generators` (every net-producing block). A block can appear on BOTH
  lists (e.g. a reactor block that also draws power for its own auxiliary
  machines) — demand and generation are computed independently per block, so
  only the two TOTALS should be compared, never a per-block net. Heat is
  intentionally NOT rolled up here — it's a short-range (~15 tile), block-local
  mechanic (Py hard mode); read a block's `heatW` from its own solve
  (`submitBlock`/`reviseBlock`) instead.
- **Belts/inserters for one good** (`logisticsFor`, #126) — the logistics half
  `buildingBill` deliberately leaves out: given `{ good, rate }`, for an ITEM it
  returns every belt tier UNLOCKED under the research horizon (the same
  `unlockedItems` gating `availableMachines`/module auto-fill use — belt/loader/
  inserter entities are themselves crafted items) with its whole belt count and
  saturation (how full the built belts run, so "can one yellow belt feed this?"
  reads straight off the first row), and every unlocked inserter/loader with the
  whole-device count to move the rate through one feed point. Stack sizes
  reflect the researched belt/inserter/bulk-inserter bonuses (`tech_stack_bonuses`)
  via the same `placedBeltStack`/`inserterHandStack` math the block editor's
  per-row logistics readout uses (#21, `lib/logistics.ts`) — evaluated across
  every unlocked tier instead of the user's one selected pick (unlike the
  editor's manual belt/mover picker, which is intentionally unfiltered). A FLUID
  short-circuits to `{ kind: 'fluid', note }` — pipe throughput isn't modelled.
  Pair with `buildingBill` for full construction coverage: machines from
  `buildingBill`, belts/inserters/loaders from this.
- **Built-vs-required status** (`blockBuildStatus`, #123) — audits blocks that
  already exist, from the last synced game state: per block, per recipe, the
  machine, the required WHOLE-building count (ceiled from `block_machines`'
  cached solved count — the same source `buildings` reports), the built count
  from `built_machines`, and the missing delta. Works entirely offline (no
  bridge round-trip, no re-solve) — the answer is only as fresh as the last
  save-load/Sync in the PyOps panel, so the tool returns `syncedAt`/
  `syncedCount` and its description tells the agent to flag staleness. Pass a
  `blockId` (a `factoryBlocks` id) for one block's full breakdown, even fully
  built or disabled (`limit` is ignored in this mode); omit it to list up to
  `limit` (1–30, default 10) **enabled** blocks with a shortfall, worst-missing
  first, matching every other factory-wide rollup's enabled-only convention
  and bounding the same nested `recipes`/`machineFallback` payload that made
  an unlimited listing unbounded on a factory with many under-built blocks.
  Built counts are force-wide (`built_machines` has
  no block association), so two blocks sharing the identical machine+recipe
  each compare independently against the same built count. Machines whose
  entity type never reports a recipe to the game — boilers, generators,
  reactors, offshore-pumps (`mod/control.lua`'s `RECIPE_TYPES`, e.g. a
  `generate-heat-*` local heat source) — come back with `built`/`missing`
  null on their `recipes` rows and are instead summarized once per machine in
  `machineFallback`, mirroring `machineSufficiency`'s existing
  recipe-aware/machine-total fallback (`queries.server.ts`) rather than
  silently misreporting them as permanently missing. The system prompt steers
  the agent here instead of `gameEval`/`gameProduction` for "what's built"
  questions, since this tool works even when the bridge is disconnected.
- **Tasks & notes** — `listTasks`/`getTask` read the user's planning to-do tree;
  `createTask` files one (with optional checklist steps and entity links);
  `updateTask`/`addTaskStep`/`linkTask` edit it. Unlike block drafts, these apply
  **directly** (low-stakes, reversible on the Tasks page), so the agent can file a
  follow-up after drafting — it's told to do so when the user agrees or asks what's
  left, checking `listTasks` first to avoid duplicates. A separate **Enhance**
  action on a task (`enrichTaskFn`, not an agent tool) rewrites a rough capture's
  title/body into something sharper while preserving the original intent.
  `listNotes` (#128) is a **read-only** sibling over the separate `notes` table
  (`db/tasks.server.ts`'s `listNotes()`) — a flat, deliberately-dumb scratch
  surface (title + freeform body, no steps, no tree) the user writes for
  themselves. It returns every note's `{ id, title, body }` in one call (the
  table is small — no pagination). Writing/editing notes is out of scope for the
  agent: Tasks already cover assistant-initiated follow-ups, and notes stay the
  user's own space.
- **Synced production stats** (`productionStats`) — batched actual produced/consumed
  per good (items or fluid /s, force-wide) read from the `production_stats` table
  (`db/queries.server.ts` `productionStatsFor`/`getProductionStats`/
  `setProductionStats`), which the mod keeps as a full-replace snapshot via
  `state.stats` (`server/bridge/handlers/stats.ts`) — pushed periodically while
  playing and refreshed on every save-load resync. Works with the game closed,
  unlike the live tools below. Because the snapshot is a full replace that drops
  near-zero rows before inserting, a good's absence once a sync has landed means
  ~0 flow, not "unknown" — the result carries `syncedAt`/`syncedCount` (from
  `meta.stats_synced_at`/`stats_synced_count`, the same fields
  `productionComparisonFn` already surfaces to the factory ledger UI) so the
  agent can tell a real "nothing's flowing" from "never synced". `gameProduction`
  (below) stays the LIVE source of truth when the companion mod is connected —
  prefer it when the bridge is up; reach for `productionStats` when it isn't, or
  to check many goods (e.g. a plan's imports) in one batch.
- **Live game-world (read-only)** — `gameContext`, `gameInspectArea`,
  `gameFindEntities`, `gameProduction` query the _running_ factory through the
  bridge (app→mod→Factorio), so the agent can ground a task in real evidence
  ("what's built here", "is X actually being made"). Bounded and structured; they
  return a clear error when the companion mod isn't connected.
- **In-game Lua eval, gated per call** (#15) — the in-app assistant's `gameEval`
  does **not** execute: it returns the snippet as a _proposal_, rendered in the
  chat as a card (`components/assistant/game-eval-card.tsx`) showing the exact
  Lua and its `note`, with **Run in game** / **Dismiss** controls. Only the
  user's Run sends `cmd.eval` over the bridge (`bridgeEvalFn` in
  `server/bridge/fns.ts`); the result shows inline with a "Share result with
  assistant" chip that feeds it back into the chat. This makes per-call consent
  real and lets the agent request careful in-game _write_ actions too. The MCP
  surface swaps in a direct-executing variant (`gameEvalDirect`, exposed as
  `mcpTools.gameEval`) — developer debugging has no chat UI to approve through.
  Defense in depth: the mod's `pyops-allow-eval` per-user setting (default on)
  refuses every `cmd.eval` when off — including the MCP screenshot capture
  below, which rides on eval.

**Developer/MCP-only tools.** `gameScreenshot`, `gameReloadMods`, `gameShowBlock`,
and `gameCloseSummary` are **not** in the in-app assistant's tool set
(`agentTools`) — only on the MCP surface (`mcpTools`, see below). The in-app chat
can't consume a local PNG path, and ordinary planning shouldn't trigger a mod
reload or drive the in-game summary panel open/closed; these are for an external
agent (e.g. Claude over MCP) debugging the mod/bridge integration directly:
- `gameScreenshot` captures the game (GUI included) to a PNG path, optionally
  auto-cropped to a top-level GUI element (`panel`) or an explicit `crop`/`scale`
  — built for designing the in-game panel live (snap, look, tweak) without a
  Factorio reload.
- `gameReloadMods` asks the connected mod to call `game.reload_mods()` after a
  mod-code edit, for a screenshot → tweak → reload loop.
- `gameShowBlock`/`gameCloseSummary` push a saved block to (or close) the
  in-game Helmod-style summary panel, exactly like the web "show in game"
  button — for self-testing the mod's UI via screenshots.

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

Both apply paths persist a draft's FULL `goals` array (#38), not just its
`target`/`rate`: `routes/assistant.tsx`'s single-block **Create block** handler
and the plan card's **Create N blocks** handler both build `BlockData.goals`
from the draft's `goals` (falling back to a synthesized single goal for an
older cached draft that predates the field), so a keep-in-stock goal's
`stock`/`window` survive into the saved block exactly as the schema (`Goal` in
`db/schema.ts`) expects. The draft card itself renders every goal (not just the
anchor) when a block has more than one, showing a stock goal as "keep N
(refill Xm)" instead of a rate.

Once a card's block exists in the store it can go **straight into the game**
(#14): the draft card's post-create state, the revise card (its block already
exists), and the plan card's created list each render a **Show in game** button
(`components/assistant/show-in-game-button.tsx`) that pushes the block to the
in-game build-sheet panel via `bridgeShowBlockFn` — the same panel whose
building rows hand out the configured blueprint / request-combinator, so a plan
flows from chat to construction. It reports "game not connected" when the
bridge is down.

Draft, update, and plan cards carry **one-click follow-up chips** (#13) built
from the solved draft data: a **Draft \<good\> @ rate** chip per suggested
sub-block and a **Route \<good\>** chip per byproduct
(`components/assistant/follow-up-chips.tsx`). Clicking one sends the matching
request as the next chat message (disabled while a run is in flight), so the
"draft super-alloy @ 3.3/s next" advice is actionable without retyping.

When the user asks to include building materials or construction coverage, the
agent is expected to call `buildingBill` with the plan's blocks and cover the
MACHINE ITEMS it returns — not silently reinterpret the request down to just raw
recipe ingredients. For each machine item it decides: an existing mall block
already supplies it (import), an existing block should be resized
(`reviseBlock`/plan `updates`), or it needs its own new block; a large bill is
grouped by shared material chains (steel/circuits/gears feeding several machine
types) rather than dropped silently. Raw resources, electricity, and broad
commodities remain imports unless the user specifically asks to produce them
too. The agent is also told not to defer this (or byproduct routing) to a
follow-up question — a requested plan ships complete, in the same turn. When
the request separately asks for belts/inserters/logistics coverage too, the
agent additionally calls `logisticsFor` per relevant good/rate and reports both
halves together — machines from `buildingBill`, belts/inserters/loaders from
`logisticsFor`.

The same tool bodies back two front doors: the in-app agent (`agentTools`) and
the MCP route (`routes/mcp.ts`), which registers **every** tool in `mcpTools` —
`agentTools` plus the developer-only tools above and the direct-executing
`gameEval` — for external MCP clients over `POST /mcp` (JSON-RPC). This lets an
external agent — e.g. Claude driving the _running game_ via the read-only
game-world tools, screenshotting the mod's UI, or reloading mods after an edit —
exercise and debug the integration directly, not just the in-app assistant. The
handler (`utils/mcp-handler.ts`) is single-shot per request and waits for the
tool's real async result (db / bridge / LLM), so slow tools work.

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
