# PyOps

<img src="app/public/logo.svg" alt="PyOps logo" width="100">

A web-based factory planner and in-game ops assistant for **Factorio**, built for
the **Pyanodons (Py)** overhaul — like [YAFC](https://github.com/Yafc-CE/yafc-ce),
but in the browser, with deep in-game integration and an AI-assisted planner. It
runs locally alongside your Factorio install and reads recipe data straight from
the game; Py-specific views (like TURD) appear only when that data is present, but
it loads whatever mod set you sync.

**Just want to run it?** PyOps ships as a self-updating **desktop app** for Linux,
macOS, and Windows — no toolchain needed. Grab a build from the
[Releases](https://github.com/ApocDev/pyops/releases) page (it still needs Factorio
installed locally to sync recipe data), or [run it from source](#run-it) to hack on
it. Build/release details: [`docs/desktop.md`](docs/desktop.md).

---

## What it does

- **Design production blocks** — set output goals + rates, pick recipes/machines/
  modules, and PyOps solves the run-rates and building counts for the whole chain
  (cyclic loops, fluid temperatures, byproducts, spoilage). Pin counts, route
  byproducts, fold chains into sub-blocks, or extract a recipe into its own block.
- **Balance the whole factory** — every block's imports/exports roll into one
  ledger (deficits, surpluses, built-vs-required machines), with what-if.
- **Explore the data** — a searchable catalogue with a recipe explorer (producers/
  consumers ranked and availability-grouped) and a dependency-tree explorer.
- **Track TURD & research** — Py's tech upgrades are first-class; pick a path and
  every block re-solves against your research horizon.
- **Plan with AI** — an OpenRouter-backed assistant drafts whole chains, honouring
  what you can build now vs. after research, and can read the live factory.
- **Reach into the running game** — a companion mod links over localhost UDP: an
  in-game block panel, locate, live sync of research/TURD/machines, and more.
- **Quality of life** — command palette (Ctrl+K), undo (Ctrl+Z), per-block
  snapshots, backup/share, tasks & notes, light/dark theme, responsive to phone.

Each subsystem has its own doc under [`docs/`](#documentation).

---

## Screenshots

**Factory ledger** — every block's flows in one balance sheet; deficits rank by %
of demand met.
![Factory ledger — whole-factory balance with deficits, surpluses, and built-vs-required machines](docs/images/factory.png)

**Block editor** — goals in, solved rates and building counts out; toggle recipes/
blocks off, fold into sub-blocks, or switch to a flow diagram.
![Block editor — the Basic substrate bio-chain, solved with byproducts](docs/images/block-editor.png)

**AI assistant** — drafts a whole block from a goal, flagging byproducts, spoilage,
and TURD upgrades.
![AI assistant drafting a py science 1 production block](docs/images/assistant.png)

**Browse** — every item, fluid, and recipe with produced-by / used-in, grouped by
availability and annotated with waste %.
![Browse — Iron plate with its producers and consumers](docs/images/browse.png)

---

## Run it

```bash
cd app
vp install        # install dependencies (Node LTS + pnpm; Vite+ handles the rest)
vp dev            # start PyOps at http://localhost:3000
```

Then open **⚙ Settings › Game data** and run a sync: PyOps launches Factorio
headlessly, reads its recipe data, and loads it into a local database (~1–2 min the
first time). Needs **Factorio 2.0** with the **Pyanodons** suite +
**pypostprocessing**.

- **Configuration** (env vars, remote access): [`docs/configuration.md`](docs/configuration.md)
- **In-game features** (companion mod, launching the bridge): [`docs/bridge.md`](docs/bridge.md)
- **AI assistant** needs an [OpenRouter](https://openrouter.ai) key (set it in
  Settings or `OPENROUTER_API_KEY`).

The dev server also exposes the PyOps MCP tool surface at
`http://localhost:3000/mcp` (project configs for Codex and Claude Code ship in the
repo).

---

## Documentation

How PyOps works under the hood lives in [`docs/`](docs/):

- [Architecture](docs/architecture.md) — the one-app-plus-mod model and repo layout.
- [Data pipeline](docs/data-pipeline.md) — how the Factorio data sync works.
- [Block solver](docs/solver.md) — the planning math.
- [Factorio bridge](docs/bridge.md) — the in-game link and its setup.
- [AI assistant](docs/ai-assistant.md) — the planning agent.
- [Configuration](docs/configuration.md) — environment variables and remote access.
- [Desktop app](docs/desktop.md) — how the Tauri bundle is built and released.

Contributing: `vp check` and `vp test` must be clean; the mod (`mod/`) is pure Lua,
no build step. See [`AGENTS.md`](AGENTS.md) for the full toolchain and conventions.

---

## Credits & inspiration

- **[YAFC](https://github.com/Yafc-CE/yafc-ce)** — the planner model, cost-analysis
  approach, and the "design blocks, balance the factory" shape.
- **[Helmod](https://mods.factorio.com/mod/helmod)** — the in-game production-block
  panel is heavily inspired by Helmod's; no Helmod assets are bundled.
- **[Factory Search](https://mods.factorio.com/mod/FactorySearch)** — the "locate in
  game" feature relays to its remote interface.
- **[pypostprocessing](https://mods.factorio.com/mod/pypostprocessing)** — makes a
  clean, planner-friendly data dump possible.

---

## License

Free software under the **GNU General Public License v3.0** — see [`LICENSE`](LICENSE).
Copyright (C) 2026 ApocDev. You're free to use, study, modify, and share it
(including commercially), but any distributed version or derivative must stay open
under the same GPLv3 terms — matching [YAFC](https://github.com/Yafc-CE/yafc-ce) and
[Helmod](https://mods.factorio.com/mod/helmod). Contributions accepted under the same
license.
