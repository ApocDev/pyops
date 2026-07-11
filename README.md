# PyOps

<img src="app/public/logo.svg" alt="PyOps logo" width="100">

PyOps is a local factory planner and in-game operations assistant for
**Factorio**. It is designed around the **Pyanodons** mods, but works with vanilla
Factorio and other mod packs by synchronizing recipes, technologies, machines,
and icons from your own game.

**[Read the PyOps documentation →](https://apocdev.github.io/pyops/)**

Installation, first project, planning workflows, game integration, reference,
and troubleshooting.

**[Download the latest release →](https://github.com/ApocDev/pyops/releases)**

Self-updating desktop builds for Linux, macOS, and Windows.

## What PyOps does

- **Design production blocks** — set output goals and rates, choose recipes and
  machines, and solve full production chains including cycles, byproducts,
  spoilage, and fluid temperatures.
- **Balance the factory** — combine every block's imports and exports in one
  ledger, identify shortfalls and surpluses, and test changes with what-if plans.
- **Explore game data** — search items, fluids, recipes, producers, consumers,
  and dependency trees from the mod set you actually use.
- **Plan around progression** — model research horizons and, when present,
  Pyanodons TURD choices throughout the factory.
- **Connect to Factorio** — use the companion mod for live research, machine,
  location, and production-plan integration.
- **Draft with the Assistant** — optionally use an OpenRouter-backed planning
  assistant that understands the current project and can propose production
  blocks for review.

The [planning guide](https://apocdev.github.io/pyops/guide/) explains how these
parts fit into a complete workflow.

## Screenshots

**Factory ledger** — the balance across every production block, including
deficits, surpluses, and machine requirements.

![Factory ledger showing whole-factory balance](docs/images/factory.png)

**Block editor** — goals in, solved rates and building counts out.

![Block editor showing a solved production chain](docs/images/block-editor.png)

**Assistant** — project-aware help for investigating and drafting production
plans.

![Assistant drafting a production block](docs/images/assistant.png)

## Developing PyOps

The repository contains three cooperating parts:

- `app/` — the TanStack Start application and Tauri desktop shell;
- `mod/` — the Factorio companion mod;
- `docs/` — the VitePress documentation site.

Start the application from source with [Vite+](https://viteplus.dev/):

```bash
cd app
vp install
vp dev
```

Run `vp check` and `vp test` from `app/` before submitting application changes.
The companion mod is pure Lua and has no build step.

For architecture, subsystem contracts, desktop packaging, and contributor
workflows, read the hosted
[development documentation](https://apocdev.github.io/pyops/development/).
Repository-specific agent conventions remain in [`AGENTS.md`](AGENTS.md).

To work on the documentation site:

```bash
cd docs
vp install
vp run docs:dev
```

## Credits and inspiration

- **[YAFC](https://github.com/Yafc-CE/yafc-ce)** — the planner model,
  cost-analysis approach, and the design-blocks/balance-factory workflow.
- **[Helmod](https://mods.factorio.com/mod/helmod)** — inspiration for the
  in-game production-block panel; no Helmod assets are bundled.
- **[Factory Search](https://mods.factorio.com/mod/FactorySearch)** — the locate
  action can relay to its remote interface.
- **[pypostprocessing](https://mods.factorio.com/mod/pypostprocessing)** —
  supplies additional planner-oriented metadata for Pyanodons data dumps.

## License

PyOps is free software under the **GNU General Public License v3.0**. See
[`LICENSE`](LICENSE). Copyright (C) 2026 ApocDev.
