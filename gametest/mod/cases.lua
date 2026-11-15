-- The measurements the engine scenario takes, one table per case. `kind` picks
-- how the scenario builds and reads it (scenarios/engine/control.lua):
--   spoil    `items`: each item's spoil ticks at every quality
--   products `recipes`: each recipe's products as the engine resolved them
--   effects  `machine` with `modules` and `beacons`: the machine's total effects
--   craft    `machine` with `modules` runs `recipe` for `crafts` crafts, spread
--            over `machines` copies; counts every product by quality
-- Modules take `module_quality`; a beacon takes `quality` and `module_quality`.
-- A case the suite's mods can't build (a missing prototype or quality, a
-- machine that won't take the modules) is reported as skipped.
-- The app's tests (app/src/gametest.test.ts) read each case back by name.

local speed = "speed-module-3"
local prod = "productivity-module-3"
local qual = "quality-module-3"

return {
  { name = "spoil-ticks", kind = "spoil", items = { "gametest-spoilable" } },

  { name = "catalyst-products", kind = "products", recipes = { "gametest-catalyst", "gametest-catalyst-noprod" } },
  {
    name = "catalyst-modules",
    kind = "craft",
    machine = "assembling-machine-3",
    modules = { prod, prod, prod, prod },
    recipe = "gametest-catalyst",
    crafts = 50,
  },
  {
    name = "catalyst-base-productivity",
    kind = "craft",
    machine = "gametest-base-prod-assembler",
    recipe = "gametest-catalyst-noprod",
    crafts = 50,
  },

  {
    name = "beacons-one-type",
    kind = "effects",
    machine = "assembling-machine-3",
    beacons = { { name = "beacon", count = 4, modules = { speed, speed } } },
  },
  {
    name = "beacons-two-types",
    kind = "effects",
    machine = "assembling-machine-3",
    beacons = {
      { name = "beacon", count = 2, modules = { speed, speed } },
      { name = "gametest-beacon-b", count = 2, modules = { speed, speed } },
    },
  },
  {
    name = "beacons-total-counter",
    kind = "effects",
    machine = "assembling-machine-3",
    beacons = {
      { name = "beacon", count = 2, modules = { speed, speed } },
      { name = "gametest-beacon-total", count = 2, modules = { speed, speed } },
    },
  },

  { name = "quality-modules", kind = "effects", machine = "assembling-machine-3", modules = { qual, qual, qual, qual } },
  {
    name = "quality-modules-legendary",
    kind = "effects",
    machine = "assembling-machine-3",
    modules = { qual, qual, qual, qual },
    module_quality = "legendary",
  },
  {
    name = "beacon-rare",
    kind = "effects",
    machine = "assembling-machine-3",
    beacons = { { name = "beacon", count = 1, quality = "rare", modules = { speed, speed } } },
  },

  {
    name = "quality-split",
    kind = "craft",
    machine = "assembling-machine-3",
    modules = { qual, qual, qual, qual },
    module_quality = "legendary",
    recipe = "gametest-quality-sample",
    crafts = 20000,
    machines = 40,
  },
}
