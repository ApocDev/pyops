---
title: In-game tests
description: Measure Factorio's own production numbers with a headless test scenario, lock mod versions per suite, and check PyOps's math against the results in Vitest.
outline: [2, 3]
---

# In-game tests

PyOps computes productivity, beacons, quality, and spoiling itself. The in-game tests check
that math against the real engine. Factorio runs a test scenario that builds each case,
reads the engine's numbers, and writes them to JSON. The JSON is committed. Vitest then runs
PyOps's own functions on the same prototypes and must get the same numbers, so regular CI
catches a math regression without Factorio installed.

Everything lives in `gametest/` at the repository root. It does not import anything from
`app/`.

| Path                             | What it is                                             |
| -------------------------------- | ------------------------------------------------------ |
| `gametest/run.ts`                | The runner: `update` locks mods, `run` measures        |
| `gametest/suites.json`           | Each suite's mod list                                  |
| `gametest/locks/<suite>.json`    | Exact mod versions and sha1s, and the game version     |
| `gametest/results/<suite>.json`  | What the engine measured, with the prototypes it used  |
| `gametest/mod/`                  | The `pyops-gametest` mod: test prototypes and scenario |
| `gametest/mod/cases.lua`         | The cases, as data                                     |
| `gametest/mod/scenarios/engine/` | The scenario that builds and measures each case        |
| `app/src/gametest.test.ts`       | The Vitest comparison                                  |

The test mod is never part of the shipped Companion mod in `mod/`. The Companion mod's own
Lua helpers keep their FactorioTest suite under `mod/tests/`.

## Run a suite

You need Factorio 2.1 with Space Age, and Node 24. The runner uses only Node's standard
library.

```sh
node gametest/run.ts run                  # every suite
node gametest/run.ts run vanilla-quality  # one suite
```

For each suite, the runner builds a mod directory and an isolated config and write-data
directory under `~/.cache/pyops-gametest/runs/<suite>/`. Then it starts Factorio in its test
mode:

```sh
factorio --config <ini> --mod-directory <dir> --test-scenario pyops-gametest/engine \
  --map-gen-seed 1 --test-ticks 40000
```

Test mode runs headless, with no window. Factorio exits as soon as the scenario calls
`script.finish_test`: exit code 0 when every case measured or was skipped, 1 when one
errored or timed out. The vanilla suite takes about a second and the Py suites under ten.
The run prints one line per case and writes `gametest/results/<suite>.json` only when the
scenario passed. The full game log is in the run directory as `factorio.log`. The map
seed also seeds quality rolls, so the fixed seed makes a rerun give identical results.

The game binary defaults to the Steam install at
`~/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio`. Set `FACTORIO_BIN` to use
another. Set `PYOPS_GAMETEST_CACHE` to move the cache.

Run the app side from `app/` like any other test:

```sh
vp test run src/gametest.test.ts
```

## Suites and mod versions

A suite is a short list of mod names in `suites.json`. The official mods (`base`, `quality`,
`recycler`, `space-age`, `elevated-rails`) come from the game's data directory. Everything
else comes from the mod portal. Official mods a suite doesn't list are disabled.

| Suite             | Mods                                                  |
| ----------------- | ----------------------------------------------------- |
| `vanilla-quality` | base, quality, recycler                               |
| `py`              | `pyalternativeenergy`, which requires the full Py set |
| `py-quality`      | the full Py set with quality and recycler             |

Factorio has no command to download mods, so the runner talks to the mod portal API:

```sh
node gametest/run.ts update            # every suite
node gametest/run.ts update py         # one suite
```

`update` takes the newest release of each mod for the installed game's major version, then
follows its required dependencies. Optional (`?`, `(?)`), recommended (`+`), and
incompatible (`!`) dependencies are skipped. It downloads each zip into
`~/.cache/pyops-gametest/mods/`, checks its sha1, and writes `locks/<suite>.json` with the
exact versions, sha1s, and game version.

`run` uses the lockfile exactly. It downloads a missing zip again and warns when the
installed game version differs from the lock. The zips are other authors' work, so they
stay in the cache and are never committed.

Downloads need a mod portal login. The runner reads `service-username` and `service-token`
from `~/.factorio/player-data.json`, which the game writes when you log in. Set
`FACTORIO_USERNAME` and `FACTORIO_TOKEN` to override them. The runner never prints them.

After an `update`, run the suite and commit the lock and the results together. The Vitest
file fails a suite whose results don't match its lockfile, so a mod bump can't land with
stale measurements.

## How a case is measured

Each case in `cases.lua` is a table with a `kind`:

| Kind       | Builds                                       | Records                                                           |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `spoil`    | nothing                                      | each item's spoil ticks at every quality                          |
| `products` | nothing                                      | each recipe's products as the engine resolved them                |
| `effects`  | a machine with modules and a ring of beacons | the machine's total effects                                       |
| `craft`    | one or more machines running a recipe        | every product made, by quality, and the leftover productivity bar |

The scenario builds every case at once, each on its own lab-tile area of a fresh surface,
with one pole and an unlimited power source. It unlocks every quality first, because a craft
only rolls up to qualities its force has unlocked. A `craft` case feeds its machines each
tick and drains their output until the last craft finishes.

A case the suite's mods can't build is skipped with a reason: a missing prototype or
quality, or a machine that won't take the case's modules. Py's assembling machine 3 has no
module slots, for example, so the module cases only measure in `vanilla-quality`.

The test mod's `data-final-fixes.lua` copies every prototype the cases use into a
`mod-data` prototype, as `data.raw` has it after every mod ran, minus graphics and sounds.
The mod optionally depends on `pypostprocessing`, so this runs after Py's final fixes. The
scenario writes those prototypes next to the measurements as `raw`.

## How the comparison works

`app/src/gametest.test.ts` reads each results file. It writes the `raw` prototypes as a
small data dump and runs the real importer on it, so the comparison covers the import
defaults too. Then each kind has one check:

- `spoil`: the imported spoil time scaled by `spoilSecondsAt` must be within one tick of the
  engine. The engine floors ticks times a 32-bit float multiplier, so uncommon is 23399
  ticks where the exact product is 23400.
- `products`: the imported product amounts and `ignored_by_productivity` must equal the
  engine's.
- `effects`: `computeEffects` must give the engine's speed, productivity, consumption,
  pollution, and quality.
- `craft`: the effects must match, and each product's count, plus the leftover
  productivity bar's share of one bonus craft, must equal crafts times `prodScaledAmount`.
  Product quality is random, so each quality's count must land within five standard
  deviations of its `qualitySplit` share.

A case where PyOps is wrong today is listed in `KNOWN_MISMATCHES` with the reason. It runs
as `it.fails`, so fixing PyOps fails the test until the entry is removed.

## Add a case

1. Add the table to `gametest/mod/cases.lua`. Use an existing kind when you can. A new
   kind is a function in `kinds` in the scenario that builds the case and returns a poll
   function, called every tick until it returns the measurements.
2. Add any test prototype to `gametest/mod/data.lua`. Prefer a copy of a real prototype
   with one change, so the case measures the real thing.
3. Run the suites and look at the new case's line in the output.
4. For a new kind, add its check to `checks` in `app/src/gametest.test.ts`.
5. Commit the case, the results, and the check together.

Prefer values the Lua API reports exactly, such as prototype getters and entity effects,
over long simulations. Use a tolerance only where the engine is random.
