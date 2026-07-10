# Factorio bridge

Code: `app/src/server/bridge/` (app side) and `mod/control.lua` (game side).

A localhost UDP socket (`node:dgram`, default port **37657**) talks to the
companion mod. The mod sends JSON request datagrams and polls for replies; the app
dispatches them to handlers (`app/src/server/bridge/handlers/`) and answers on the
same socket. The socket is a process singleton stashed on `globalThis` so Vite HMR
re-evaluating the module reuses the existing bind instead of throwing
`EADDRINUSE`. Transient UDP delivery errors during a game or dev-server reload
clear the remembered peer but do not close the app's listener; the mod's next
heartbeat registers its current source port and restores the link.

## Status in the UI

The global nav carries a compact status indicator (`app/src/components/bridge-indicator.tsx`):
a colored dot + label (game linked / no game / mod mismatch / bridge error) with a
tooltip, linking to **Settings › In-game link**. It shares the `["bridgeStatus"]`
query with the fuller **Live bridge** card on that tab, so the two never disagree —
and mounting either is what `ensureBridge()`s the socket, so the listener comes up
on any page. The same tab hosts the companion-mod installer (see below).

## What flows across it

- **Live state → app:** researched technologies, TURD selections, placed machines
  (keyed by the recipe each crafts — and mining drills by the resource they're on,
  as the solver's synthetic `mine-<resource>` recipe, so built-vs-required lines up
  per ore), and item production stats — pushed on connect and on relevant in-game
  events, always as the full authoritative set (no delta merging on the app side).
- **Commands → game:** show a production-block panel in-game (`cmd.show_block`)
  and close it again (`cmd.hide_block`), locate producers/consumers/storage
  (`cmd.locate`, relayed to the
  [Factory Search](https://mods.factorio.com/mod/FactorySearch) mod's remote
  interface), and put an app-built blueprint string on the player's cursor
  (`cmd.blueprint` — e.g. the sushi planner's set-point combinator; the mod
  refuses politely if the cursor is holding something).
- **Sushi-loop tracer (`mod/sushi.lua`):** hover a belt and press ALT+B — the mod
  flood-fills the belt loop (belts, undergrounds, splitters; lane balancers are
  handled as graphs), prunes feed-on/feed-off spurs so only the circulating core
  counts, sets one "read entire belt (hold)" reader per game segment (segments
  end at splitters and sideload merges; undergrounds CONTINUE the segment,
  buried span included — probed empirically with isolated readers), places the
  readers at the junction cluster where segments meet, and connects them with a
  minimum spanning tree of short player-legal wires (prototype reach; if a gap
  can't be bridged belt-to-belt it prints GPS-linked power-pole suggestions
  instead). Skip-and-warn on belts you already wired. The measured loop
  (`sushi.trace`: tiles/segments/closed) lands in the app, where the sushi
  planner offers it as a one-click loop length. SHIFT+ALT+B removes exactly what
  the last trace added. A `pyops-sushi` remote interface exposes trace/untrace
  for tooling. Read accuracy: splitter internals aren't circuit-readable (the
  read undercounts by the in-splitter transit population) and "entire belt"
  zones bleed into adjacent feeder branches — on a circulating loop the error
  is a handful of items either way. Verified against exact item censuses on a
  scripted torture loop (5 splitters, bypass arms, tier-weaved undergrounds).
- **Task panel:** the in-game panel's **Tasks** tab pulls the project's
  tasks with `task.list` (the app replies with the full set — title, status,
  priority, body, steps, and links resolved to Factorio sprite paths) and renders
  them as a master-detail list (`mod/tasks.lua`, styled with the `pyops_*` kit).
  Read-only for now (status/step writes come later); it re-pulls on open, on the
  refresh button, and after a capture.
- **New task → app:** the panel's **+ New task** dialog sends a title +
  description plus best-effort anchors (surface/position + the entity the player
  last hovered) as `task.capture`; the app files the task and replies
  `task.captured`, after which the mod re-pulls `task.list`. The anchors become
  `entity`/`location` task links. (The web `/tasks` page keeps itself fresh to a
  mod-side write via refetch-on-focus + a light visible interval — no push channel
  yet.)
- **Read-only inspection (app→mod request/response):** the app pushes a
  `cmd.*` (`game_context`, `inspect_area`, `find_entities`, `production`) with a
  `request_id`; the mod runs a bounded game query and replies `bridge.result`
  echoing that id. `server/bridge/inspect.ts` correlates the reply to the
  awaiting caller (with a timeout). These back the assistant's read-only
  game-world tools — no whole-map dumps. (This reuses the same app→peer push as
  `request.sync`; the mod must be polling — i.e. the bridge enabled.)
- **Developer visual loop:** MCP clients get `gameScreenshot` for GUI-inclusive
  screenshots and `gameReloadMods` for a safe mod reload. `gameReloadMods` sends
  `cmd.dev.reload_mods`; the mod acknowledges, schedules `game.reload_mods()` for
  the next tick, then the app waits for the normal bridge heartbeat/resync before
  further inspection. This replaces desktop click automation for normal
  `control.lua` / GUI iteration. If the currently loaded mod predates the command,
  reload Factorio manually once.

## Transport requirements

The mod uses Factorio's `helpers.send_udp` / `recv_udp`, which the engine only
exposes when the game is launched with `--enable-lua-udp <port>`. That `<port>` is
the socket **Factorio binds for itself**, so it must be a _different_ free port
than the app's bridge port (`PYOPS_BRIDGE_PORT`, default `37657`) — two processes
can't bind the same loopback UDP port, and Factorio otherwise fails at startup with
`Opening Lua UDP Socket failed: Binding IPv4 socket failed: Address already in use`.
Use e.g. `--enable-lua-udp 37658` and leave the mod's `pyops-bridge-port` setting at
the app's port; the mod always sends to that app port, and the app replies to
whatever source port Factorio's socket used. The app's **Live bridge** card has a
**Launch Factorio** button that sets this flag automatically (picking a free port
next to the app's), so users normally don't touch it by hand. There's no enable
toggle — the mod runs the bridge automatically whenever the game was launched with
the flag, and disables itself for the session (with an in-panel hint) if the flag is
absent. The loopback-only socket means the game and the app must run on the same
machine.

## The wire contract

`app/src/server/bridge/protocol.ts` is the pure envelope layer — request/response
types plus parse/serialize, with no transport and no Node dependencies, so handlers
and tests can use it without touching the socket.

The contract version (`PROTOCOL_VERSION`) lives in **both** `protocol.ts` and
`mod/control.lua` and must stay in lockstep — bump both sides whenever the message
shapes change. Each side reports its version and warns when the other disagrees.

## The companion mod

`mod/` is a normal Factorio 2.1 mod — pure Lua, no build step:

- `control.lua` — the in-game panel, the UDP bridge, and live-state sync.
- `summary.lua` — the Helmod-style production-block view (`cmd.show_block`),
  including the clickable factory cell that puts a configured blueprint on the
  cursor. Goods are rendered as locked signal buttons (styled with the blue/yellow
  slot styles — blue for products, yellow for ingredients — so the recipe/in/out
  split reads at a glance) so the engine's own smart-pipette (Q) grabs the
  item/fluid as a filter signal; Q over a factory/beacon cell pipettes the building.
  A titlebar toggle shows a Helmod-style belts/inserters readout on each good — the
  counts are computed app-side (the `cmd.show_block` payload carries per-good
  `belts`/`inserters` plus a top-level `logistics` descriptor with the chosen
  belt/mover for the icons), honouring the web Logistics **show-belts/show-inserters**
  toggles (so it renders just belts, just inserters, or both), and reusing the web
  Logistics math and picks rather than recomputing in Lua.
- `combinator.lua` — the in-game request-combinator planner.
- `data.lua`, `settings.lua` — prototypes and the per-player bridge port setting.

It's verified hands-on in-game; there's no automated test harness for the Lua side.
After editing anything under `mod/`, reload it in-game. Once a save is already
running a mod version with the developer command above, the MCP `gameReloadMods`
tool can do that reload without window automation. Prototype/data-stage edits and
cases where the mod fails before the bridge starts still need a normal game
restart or manual reload.

### Installing it

**Settings › In-game link** installs `mod/` into the Factorio mods folder for you
(`app/src/server/companion-mod.server.ts`, `companion-mod-fns.ts`,
`components/companion-mod-card.tsx`). Two OS-aware methods: a **symlink**
(recommended — the installed mod tracks the repo; a directory junction on Windows,
so no admin/Developer Mode) or a plain **copy**. It detects current install state
(linked / copied / broken / out-of-date) and only ever removes a target it can
prove is ours (a symlink, or a directory whose `info.json` name is `pyops`). The
target is always `<mods>/pyops` — the folder name must equal the mod's info.json
name.

To install by hand instead, link or copy `mod/` into your mods folder as a folder
named `pyops`, from the repo root:

```bash
# Linux
ln -s "$PWD/mod" ~/.factorio/mods/pyops
# macOS
ln -s "$PWD/mod" ~/"Library/Application Support/factorio/mods/pyops"
```

```powershell
# Windows (PowerShell) — directory junction, no admin needed:
New-Item -ItemType Junction -Path "$env:APPDATA\Factorio\mods\pyops" -Target "$PWD\mod"
```

Or copy the `mod` folder in and rename the copy to `pyops` (re-copy after updates).

### Launching the game

Easiest: **Launch Factorio** in the **Live bridge** card — it starts the game with
`--enable-lua-udp` on a free port (through Steam if that's your copy, so cloud
saves / overlay / achievements keep working). To start it yourself, add
`--enable-lua-udp 37658` (Steam: right-click the game → Properties → Launch
Options). That port is the socket Factorio **binds for itself**, so it must be a
_different_ free port than the app's bridge port (`PYOPS_BRIDGE_PORT`, default
`37657`) — the two can't share one loopback UDP port. Leave the mod's **PyOps
bridge UDP port** setting at the app's port. With PyOps running, the in-game panel
connects automatically — there's no toggle to flip.
