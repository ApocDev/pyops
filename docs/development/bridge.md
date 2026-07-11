---
title: Factorio bridge
description: Understand the localhost UDP transport, versioned message contract, live-state ownership, Companion mod modules, security boundaries, and development workflow.
outline: [2, 3]
---

# Factorio bridge

The optional Companion mod connects a running Factorio save to the local PyOps server. The
app side lives under `app/src/server/bridge/`; the game side is the Lua code under `mod/`.

The core planner does not depend on this integration. Without a peer, bridge reads return a
clear unavailable result and project-owned planning continues normally.

For installation, ports, persistent Steam launch options, and end-user troubleshooting,
see [Connect PyOps to Factorio](../guide/in-game-link).

## Transport topology

The app binds a UDP4 socket to `127.0.0.1` on `PYOPS_BRIDGE_PORT`, default `37657`.
Factorio binds its own loopback UDP socket when launched with
`--enable-lua-udp <game-port>`. The ports must differ.

```text
PyOps server                              Factorio process
127.0.0.1:37657                           127.0.0.1:<game-port>
       ▲                                          │
       └──── mod sends request datagrams ─────────┘
       └──── app replies to source address ──────▶
```

The mod initiates contact with `bridge.ping` and continues polling for app-to-game
commands. The app remembers the source address and port of the most recent valid peer, so
it does not need to know Factorio's chosen port in advance.

The transport is local, connectionless, and best effort. Application semantics therefore
favor full authoritative snapshots and idempotent refreshes over ordered deltas.

## App-side runtime

`app/src/server/bridge/server.ts` owns the Node `dgram` socket. `ensureBridge()` is
idempotent and is called by the bridge status and request surfaces.

### HMR-safe ownership

The runtime is stored on `globalThis` so Vite module re-evaluation can reuse an already
bound socket. `BRIDGE_VERSION` identifies the socket implementation; changing socket
plumbing can bump it so the next `ensureBridge()` closes and replaces a stale runtime.

Message dispatch is dynamically imported for every datagram. Handler changes therefore
take effect during development without rebinding the UDP listener.

### Peer recovery

Factorio may replace its UDP socket during a reload. An asynchronous send can then surface
an unreachable-port error even though the app listener remains healthy. The runtime clears
only the remembered peer and keeps listening. The next heartbeat registers Factorio's new
source port.

Binding failures are different: they put the runtime into an error state and close the
failed socket. A later `ensureBridge()` attempt can create a fresh listener after the port
conflict is resolved.

Runtime status includes listener state, bind error, packet counters, last peer, last-seen
time, player, mod version, and both protocol versions. The compact navigation indicator and
full Settings card read the same server function and query key.

## Wire contract

`app/src/server/bridge/protocol.ts` is the transport-independent envelope layer. It has no
Node socket dependency and can be tested with plain strings or buffers.

Requests from the mod have this shape:

```ts
type BridgeRequest = {
  protocol_version: number;
  type: string;
  request_id?: string;
  tick?: number;
  player?: string;
  mod_version?: string;
  payload?: unknown;
};
```

Responses contain a type, optional correlation ID, optional app protocol version, and
type-specific payload.

`parseRequest()` validates the envelope fields and treats the payload as unknown. Domain
handlers remain responsible for validating their own payloads. Malformed JSON is ignored;
an unknown message type receives no response.

### Protocol version

`PROTOCOL_VERSION` is declared in both `protocol.ts` and `mod/control.lua`. Change both
constants whenever an existing message shape or required behavior becomes incompatible.
Heartbeat responses carry the app version, and the status surfaces compare it with the
peer's value.

`app/src/server/bridge/protocol.test.ts` reads the Lua source and asserts that the constants
match. A protocol bump is incomplete until that lockstep test passes.

Adding an optional message type that both sides can safely ignore may not require a version
bump. Changing required fields, field meaning, or correlation behavior does.

## Message ownership

### Mod to app

`app/src/server/bridge/handlers.ts` dispatches inbound request types to small domain
handlers:

| Type             | Ownership and result                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| `bridge.ping`    | Registers liveness and returns `bridge.pong` with the app protocol version         |
| `state.research` | Replaces the project's authoritative researched set and exact productivity context |
| `state.turd`     | Replaces synchronized TURD selections and refreshes affected solves                |
| `state.built`    | Replaces placed-machine counts used by built-versus-required views                 |
| `state.stats`    | Replaces current production and consumption rates                                  |
| `sushi.trace`    | Stores the most recent measured sushi-loop geometry                                |
| `task.capture`   | Creates a project task from the in-game capture dialog                             |
| `task.list`      | Returns the complete task list for the in-game panel                               |
| `bridge.result`  | Resolves an awaiting app-to-mod request by `request_id`                            |

Live-state messages are snapshots, not patches. The mod sends the complete canonical set
on connection, explicit sync, and relevant game events. Machine changes are debounced into
a full refresh, and periodic reconciliation covers script-driven changes that do not raise
the expected build or recipe events.

Handlers normalize untrusted payload values before writing. Research and TURD handlers
advance the solve-projection generation only when their canonical state changed; repeated
heartbeats and identical snapshots do not trigger unnecessary block solves.

### App to mod

Once a peer is known, `sendToPeer()` can push commands to Factorio:

- `request.sync` asks the mod to send complete live state;
- `cmd.show_block` and `cmd.hide_block` control the production summary panel;
- `cmd.locate` delegates supported entity searches to Factory Search;
- `cmd.blueprint` places a generated blueprint on the player's cursor when safe;
- `cmd.game_context`, `cmd.inspect_area`, `cmd.find_entities`, and `cmd.production` perform
  bounded read-only inspection;
- `cmd.eval` proposes an explicitly approved Lua read or write;
- `cmd.dev.reload_mods` schedules `game.reload_mods()` on the next tick.

The mod polls independently of whether its panel is visible, so live sync and Assistant
inspection do not depend on an open GUI.

## Correlated requests

`app/src/server/bridge/inspect.ts` turns UDP commands into Promise-based request/response
calls:

1. Generate a UUID `request_id`.
2. Add it to an in-memory pending map with a timeout.
3. Send the `cmd.*` envelope to the remembered peer.
4. Let the mod reply with `bridge.result` and the same ID.
5. Resolve the matching pending call and discard late or unknown replies.

If no peer is registered, the call rejects immediately. If the reply does not arrive in
time, the pending entry is removed and the caller receives a timeout. This is used by the
Assistant's structured live-game tools and developer inspection helpers.

The pending map is process memory by design. A server restart cancels active inspections;
it does not affect persisted project or live snapshot data.

## Companion mod structure

The Factorio side is a normal 2.1 mod with no JavaScript build step:

| File             | Responsibility                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `control.lua`    | Lifecycle, panel shell, UDP poll/heartbeat, live-state collection, command dispatch, and event registration |
| `summary.lua`    | Helmod-style saved-block summary and logistics display                                                      |
| `tasks.lua`      | In-game task list, detail view, and task capture                                                            |
| `sushi.lua`      | Belt-loop tracing, circuit readers, and trace cleanup                                                       |
| `combinator.lua` | Request-combinator planning tools                                                                           |
| `data.lua`       | Custom inputs, shortcuts, and runtime prototypes                                                            |
| `settings.lua`   | Bridge port and app-driven Lua-eval settings                                                                |
| `gui-styles.lua` | Shared Factorio GUI style definitions                                                                       |

### Saved-block summary

`cmd.show_block` carries the solved rows, localized names, icons, flows, machine choices,
and logistics estimates required by `summary.lua`. Lua renders that payload; it does not
reimplement the web solver or belt/inserter math.

Signal-style goods buttons preserve Factorio's smart-pipette behavior. Building and beacon
cells can likewise pipette their placeable entities. The logistics toggle follows the web
project's belt and mover selections carried in the command payload.

### Sushi-loop tracer

The tracer starts from the hovered belt and finds the circulating graph across belts,
undergrounds, and splitters. It removes feed and takeoff spurs, divides the loop into
circuit-readable segments, and places one hold-mode reader per segment.

Readers are connected with short legal wires; gaps that cannot be bridged produce
GPS-linked pole suggestions. Cleanup removes only entities and wires created by the most
recent trace. The resulting tile, segment, and closure measurements are sent as
`sushi.trace` for the web planner.

Splitter internals are not directly circuit-readable, and adjacent branches can influence
an entire-belt read. The result is an operational loop estimate rather than an exact item
census.

### Tasks

The task panel requests `task.list` when opened or refreshed and renders project tasks with
resolved Factorio sprite paths. Task capture sends title, description, surface, position,
and the most recently hovered entity when available. The app creates the task and returns a
capture acknowledgement before the mod refreshes its list.

Task edits remain app-owned; the game panel reads tasks and captures new work without
maintaining a second task state model.

## Security boundaries

The standard listener is bound to loopback. UDP messages are not authenticated, so the
port must not be exposed to an untrusted network.

Structured inspection commands are bounded and read-only. Arbitrary Lua evaluation is a
separate path with defense in depth:

- the Assistant presents each snippet for explicit user approval;
- the mod checks the per-user **Allow app-driven Lua eval** setting;
- the evaluation environment exposes a controlled set of game values;
- app-driven evaluation is restricted to single-player use because network-driven code can
  desynchronize multiplayer.

Blueprint placement refuses to replace an occupied cursor. Commands that mutate game state
should follow the same explicit-approval and fail-safe pattern.

## Companion mod installation ownership

`app/src/server/companion-mod.server.ts` detects the Factorio mods directory and manages a
target named `pyops`. It supports a symlink (a directory junction on Windows) or a copied
directory.

Removal is conservative: the installer deletes only a symbolic link or a directory whose
`info.json` identifies it as the PyOps mod. User procedures and copy-update behavior belong
in the [in-game link guide](../guide/in-game-link#install-the-companion-mod), not this
protocol document.

## Development workflow

After any change under `mod/`, reload the mod before verification. When the connected save
already supports the developer command, use `gameReloadMods`; it acknowledges the request,
schedules a reload for the next tick, and waits for the normal heartbeat and full resync.

Changes to data-stage prototypes, settings, or a mod version that cannot start the bridge
require Factorio's normal reload/restart path.

### Tests

- `protocol.test.ts` covers envelope parsing, serialization, errors, and app/Lua version
  lockstep.
- `server.test.ts` covers binding, heartbeat, malformed input, packet accounting, transient
  send errors, and app-to-mod round trips.
- handler tests cover payload normalization, persistence, idempotent re-solve behavior, and
  task responses.
- `inspect.test.ts` covers correlation, missing peers, timeouts, and late replies.
- `app/e2e/bridge.e2e.ts` exercises a UDP round trip against the running application.
- pure Lua helpers under `mod/tests/` run through `factorio-test`; GUI and game-API behavior
  still require a live Factorio pass.

### Adding a message

1. Define the payload ownership and whether the message is a snapshot, command, or
   correlated request.
2. Validate payloads at the receiving boundary.
3. Add a focused handler module instead of expanding the central dispatcher.
4. Add the Lua sender or command branch and preserve unknown-message tolerance.
5. Decide whether the change requires a protocol-version bump; update both sides if so.
6. Test malformed input, missing peers, timeouts, repeated delivery, and restart behavior as
   applicable.
7. Run the live flow after reloading the mod.

The bridge is best effort. New behavior must remain safe when a datagram is lost, repeated,
or delivered after either process restarted.
