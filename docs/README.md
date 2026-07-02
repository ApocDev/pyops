# PyOps documentation

Developer-facing docs: how PyOps is put together and why. For installing and using
PyOps, see the [top-level README](../README.md).

- [Architecture](architecture.md) — the one-app-plus-mod model, the system diagram,
  repository layout, and per-project databases.
- [Data pipeline](data-pipeline.md) — how PyOps dumps Factorio's prototype data and
  turns it into a queryable SQLite store + icon atlas.
- [Block solver](solver.md) — the linear-system block solver and the factory-level
  what-if LP.
- [Factorio bridge](bridge.md) — the localhost UDP link between the app and the
  companion mod, and what flows across it.
- [AI assistant](ai-assistant.md) — the planning agent, its tools, and the MCP
  surface.
- [Design system](design.md) — the web app's shared visual/interaction spec:
  tokens, type scale, primitives, page anatomy, and required interaction states.
- [Desktop app & releases](desktop.md) — the Tauri shell, packaging into a
  self-contained bundle, the release-please pipeline, and self-update.

See also [`AGENTS.md`](../AGENTS.md) for the contributor/agent working guide
(toolchain commands, conventions, issue tracking).
