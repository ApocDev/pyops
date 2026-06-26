# Mod tests (factorio-test)

The mod is verified hands-on in-game, but the **pure** helpers (game-free table /
string transforms) are covered by an automated suite that runs inside Factorio via
[`factorio-test`](https://github.com/GlassBricks/FactorioTest) (busted-style,
bundled luassert).

## What's covered

- `tests/combinator-test.lua` — `combinator.lua`'s pure helpers, exposed for tests
  on `Combinator._internal`: `group_add`, `sorted_groups`, `measured_totals`,
  `totals_caption`, `network_signal`.

These need no game state, so the assertions are deterministic. Logic that touches
`LuaEntity`/`game`/blueprints (`on_selected`, `build_combinator`, GUI handlers)
stays hands-on for now.

## How it's wired

`control.lua` hands the suite to the framework only when the `factorio-test` mod is
present — inert in normal play (it is never a runtime dependency of pyops):

```lua
if script.active_mods["factorio-test"] then
  require("__factorio-test__/init")({ "tests/combinator-test" }, {})
end
```

## Running it

**In-game:** install the `factorio-test` mod (mod portal), enable it alongside
pyops, load any save, then open the Tests panel (top-left) → pick pyops →
"Reload mods and run tests".

**Headless / CI:** use the CLI, which launches Factorio, runs the suite, and exits
non-zero on failure:

```bash
npm install -g factorio-test-cli
factorio-test run \
  --factorio-path /path/to/factorio/bin/x64/factorio \
  --data-directory /path/to/factorio/data \
  --mod-path "$(git rev-parse --show-toplevel)/mod"
```

CI scaffolding lives in `.github/workflows/mod-test.yml` (manual `workflow_dispatch`
— it needs a runner with a Factorio binary, so it's gated off by default).

## Adding a suite

1. Add `tests/<name>-test.lua` (busted-style `describe`/`test` + luassert `assert`).
2. Add `"tests/<name>-test"` to the require list in `control.lua`.
3. Keep assertions on game-free logic; expose new pure helpers via a module's
   `_internal` table rather than reaching into locals.
