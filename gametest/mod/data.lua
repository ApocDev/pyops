-- Test prototypes the cases build. Copies of vanilla prototypes keep every
-- number they don't name, so a case measures the real thing with one change.

local icon = { icon = "__base__/graphics/icons/iron-plate.png", icon_size = 64 }

local function item(name, extra)
  local proto = { type = "item", name = name, stack_size = 100, subgroup = "intermediate-product" }
  for k, v in pairs(icon) do proto[k] = v end
  for k, v in pairs(extra or {}) do proto[k] = v end
  return proto
end

-- A copy of a vanilla prototype under a new name, or nil when the mod set
-- removed the original.
local function copy(type, from, name, changes)
  local original = data.raw[type][from]
  if not original then return nil end
  local proto = table.deepcopy(original)
  proto.name = name
  proto.next_upgrade = nil
  for k, v in pairs(changes) do proto[k] = v end
  return proto
end

-- The catalyst recipes give three products, one per way to set the ignored
-- part: only ignored_by_stats (the engine then defaults ignored_by_productivity
-- to it), both set, and neither.
local function catalyst(name, allow_productivity)
  return {
    type = "recipe",
    name = name,
    icon = icon.icon,
    enabled = true,
    energy_required = 0.05,
    allow_productivity = allow_productivity,
    ingredients = { { type = "item", name = "gametest-plate", amount = 1 } },
    results = {
      { type = "item", name = "gametest-plate", amount = 3, ignored_by_stats = 2 },
      { type = "item", name = "gametest-widget", amount = 3, ignored_by_stats = 2, ignored_by_productivity = 0 },
      { type = "item", name = "gametest-part", amount = 3 },
    },
  }
end

data:extend({
  item("gametest-plate"),
  item("gametest-widget"),
  item("gametest-part"),
  item("gametest-spoilable", { spoil_ticks = 18000, spoil_result = "gametest-plate" }),
  catalyst("gametest-catalyst", true),
  catalyst("gametest-catalyst-noprod", false),
  {
    type = "recipe",
    name = "gametest-quality-sample",
    enabled = true,
    energy_required = 0.05,
    ingredients = { { type = "item", name = "gametest-plate", amount = 1 } },
    results = { { type = "item", name = "gametest-widget", amount = 1 } },
  },
})

-- pairs skips a copy whose original is missing
for _, proto in pairs({
  -- an assembler with built-in productivity, like Space Age's foundry or Py's
  -- TURD machines
  copy("assembling-machine", "assembling-machine-3", "gametest-base-prod-assembler", {
    effect_receiver = { base_effect = { productivity = 0.5 } },
  }),
  -- a second beacon type with vanilla's same_type counter
  copy("beacon", "beacon", "gametest-beacon-b", {}),
  -- a beacon that counts every beacon reaching the machine
  copy("beacon", "beacon", "gametest-beacon-total", { beacon_counter = "total" }),
  -- one pole powers a whole case
  copy("electric-pole", "medium-electric-pole", "gametest-pole", {
    supply_area_distance = 32,
    maximum_wire_distance = 64,
  }),
}) do
  data:extend({ proto })
end
