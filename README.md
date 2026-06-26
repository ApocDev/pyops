# PyOps

A web-based factory planner and in-game ops assistant for **Factorio**, built for
the **Pyanodons (Py)** overhaul. Think [YAFC](https://github.com/Yafc-CE/yafc-ce),
but in the browser, simpler, with deep in-game integration and an AI-assisted
planner that actually understands Py's tangled recipe graph.

---

## What it does

- **Design production blocks.** Pick a target output, choose the recipes and
  machines, set modules/beacons, and PyOps solves the run-rates and building
  counts for the whole chain — including Py's cyclic recipe loops, fluid
  temperatures, and fractional machine counts.
- **Balance the whole factory.** Every block's boundary flows (imports/exports)
  roll up into a factory-wide ledger so you can see deficits, surpluses, and how a
  change in one block ripples through the rest ("what-if").
- **Browse the data.** A searchable catalogue of every item, fluid, and recipe in
  your exact mod set — used-in / produced-by, ingredients, products, machines.
- **Track TURD choices.** Py's "There's Usually a Recipe Difference" tech upgrades
  are first-class: pick a path and every block re-solves against it.
- **Plan with AI.** An assistant (via OpenRouter) drafts whole production chains
  and multi-block plans using tools over the recipe data, honouring what you can
  build *now* vs. *after research*.
- **Keep tasks & notes.** A per-project planner: nested tasks (a markdown
  description, a checklist of steps, and child tasks for bigger breakdowns) that
  link to the recipes, items, fluids, research, and blocks they involve — plus a
  separate scratch-notes surface for quick calcs and reminders. Kept in the
  project's store, distinct from this repo's dev tracker.
- **Reach into the running game.** A companion Factorio mod links over localhost
  UDP: it shows a Helmod-style production-block panel in-game, locates
  producers/consumers via Factory Search, syncs your researched tech / TURD picks /
  placed machines back into the planner, lets you **quick-capture a task** while
  playing (with your location and selected entity as anchors), and can plan a
  Cybersyn request combinator for a station in-game. The assistant can also read
  the live factory through the bridge to ground its planning.

PyOps runs locally on your own machine, alongside your Factorio install — it reads
the recipe data straight from the game and (optionally) talks to a running session.

---

## Requirements

- **Node.js** (current LTS) and **pnpm** — the app's toolchain ([Vite+](https://viteplus.dev/),
  the `vp` CLI) handles the rest.
- **Factorio 2.0** installed locally, with the **Pyanodons** mod suite and
  **pypostprocessing** — PyOps reads your recipe data by running the game's data
  dump.
- *Optional, for the in-game features:* the PyOps companion mod (in [`mod/`](mod/))
  and the [Factory Search](https://mods.factorio.com/mod/FactorySearch) mod.
- *Optional, for the AI assistant:* an [OpenRouter](https://openrouter.ai) API key.

---

## Setup

```bash
cd app
vp install        # install dependencies
vp dev            # start PyOps at http://localhost:3000
```

Then open PyOps, go to **⚙ Settings › Game data**, and run a sync. PyOps launches
your Factorio install headlessly, reads its recipe data, and loads it into a local
database. The first sync takes ~1–2 minutes (longer if you include icons).

If your Factorio isn't installed at the default Steam location, point PyOps at it
with the `FACTORIO_BIN` / `FACTORIO_DATA_DIR` settings below.

### Using the in-game features

The companion mod ([`mod/`](mod/)) links the planner to a running game over
localhost.

**1. Put the mod in your Factorio mods folder.** The easiest way is the
**Companion mod** card under **⚙ Settings › In-game link** — it detects your OS and
installs the mod into your Factorio mods folder for you, either as a symlink
(recommended — it tracks the repo, so pulling updates the mod) or a plain copy. On
Windows the "symlink" is a directory junction, so it needs no admin or Developer
Mode.

To do it by hand instead, link or copy `mod/` into your mods folder as a folder
named `pyops`, from the repo root:

*Linux*
```bash
ln -s "$PWD/mod" ~/.factorio/mods/pyops
```

*macOS*
```bash
ln -s "$PWD/mod" ~/"Library/Application Support/factorio/mods/pyops"
```

*Windows (PowerShell, from the repo root)*
```powershell
# directory junction — no admin needed (what the in-app button uses):
New-Item -ItemType Junction -Path "$env:APPDATA\Factorio\mods\pyops" -Target "$PWD\mod"
```

Or just copy the `mod` folder into the mods folder and rename the copy to `pyops`
(you'll need to re-copy after updates).

**2. Launch Factorio with `--enable-lua-udp 37657`** — PyOps' bridge transport.
(Steam: right-click PyOps' game → Properties → Launch Options.)

**3. Enable the bridge in-game** in the **per-player mod settings**
(Settings → Mod settings → Per player).

With PyOps running, the in-game panel connects automatically. From there you get
the production-block view, in-world locate, and live sync of your research, TURD
picks, and placed machines back into the planner.

---

## Configuration

Set these in `app/.env.local` (or the environment). All are optional.

| Setting              | Default                                     | Purpose |
| -------------------- | ------------------------------------------- | ------- |
| `FACTORIO_BIN`       | `~/.local/share/Steam/.../bin/x64/factorio` | Path to the Factorio executable used for data syncs. |
| `FACTORIO_DATA_DIR`  | `~/.factorio`                               | Factorio user data (mods, `script-output`). |
| `OPENROUTER_API_KEY` | —                                           | AI **Assistant** key. Optional — set it here *or* in **Settings → Assistant** (env wins). |
| `PYOPS_AGENT_MODEL`  | `~anthropic/claude-sonnet-latest`           | Any OpenRouter model id. Optional — set it here, per chat, or in **Settings → Assistant** (env wins). |
| `PYOPS_BRIDGE_PORT`  | `37657`                                     | UDP port for the Factorio bridge (must match the `--enable-lua-udp` port). |
| `DATABASE_URL`       | active project's file (else `projects/default.db`) | Override the local SQLite file. |

---

## Documentation

How PyOps works under the hood lives in [`docs/`](docs/):

- [Architecture](docs/architecture.md) — the one-app-plus-mod model and repo layout.
- [Data pipeline](docs/data-pipeline.md) — how the Factorio data sync works.
- [Block solver](docs/solver.md) — the planning math.
- [Factorio bridge](docs/bridge.md) — the in-game link.
- [AI assistant](docs/ai-assistant.md) — the planning agent.

### Developing locally

PyOps uses [Vite+](https://viteplus.dev/) (the `vp` CLI) as its toolchain. From
inside [`app/`](app/):

```bash
vp install        # install dependencies (after pulling)
vp dev            # dev server at http://localhost:3000
vp check          # format + lint + typecheck — keep this clean
vp test           # run the Vitest suite
```

The end state of any change should be a clean `vp check`. The Factorio mod
([`mod/`](mod/)) is pure Lua with no build step — edit in place and reload the game
to test. See [`AGENTS.md`](AGENTS.md) for the full toolchain commands and
conventions (commit style, the database commands, and the project layout).

---

## Credits & inspiration

- **[YAFC](https://github.com/Yafc-CE/yafc-ce)** — the planner model,
  the cost-analysis approach, and the overall "design blocks, balance the factory"
  shape.
- **[Helmod](https://mods.factorio.com/mod/helmod)** — the in-game production-block
  panel is heavily inspired by, if not close to ripped from, Helmod's
  production-block view. No Helmod assets are bundled; colored cells use Factorio's
  built-in `blue_slot`/`yellow_slot` styles.
- **[Factory Search](https://mods.factorio.com/mod/FactorySearch)** — the
  "locate in game" feature relays to Factory Search's remote interface rather than
  reimplementing producer/consumer/storage search.
- **[pypostprocessing](https://mods.factorio.com/mod/pypostprocessing)** — its
  planner/YAFC integration is what makes a clean, planner-friendly data dump
  possible.

---

## License

PyOps is free software, licensed under the **GNU General Public License v3.0** —
see [`LICENSE`](LICENSE) for the full text.

Copyright (C) 2026 ApocDev.

In short: you're free to use, study, modify, and share PyOps, including
commercially — but any distributed version (and any derivative built on it) must
stay open under the same GPLv3 terms. It can't be taken closed-source. This
matches the lineage of the tools that inspired it ([YAFC](https://github.com/Yafc-CE/yafc-ce)
and [Helmod](https://mods.factorio.com/mod/helmod) are GPLv3 as well).

Contributions are accepted under the same GPLv3 license.
