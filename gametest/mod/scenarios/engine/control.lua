-- The engine scenario: builds every case in cases.lua on its own surface,
-- measures it, writes script-output/results.json, and finishes the test.
-- gametest/run.ts starts it with Factorio's --test-scenario; the test fails
-- when a case errors or times out. A case the suite's mods can't build (a
-- missing prototype, a machine that won't take its modules) is skipped with a
-- reason instead. See docs/development/gametest.md.

local cases = require("__pyops-gametest__.cases")
local captured = prototypes.mod_data["pyops-gametest"].data

local SPACING = 64 -- tiles between case origins
local MAX_TICKS = 60 * 60 * 10

local surface

-- quality names from normal up, following `next`
local function quality_chain()
  local out, q = {}, prototypes.quality.normal
  while q do
    out[#out + 1] = q.name
    q = q.next
  end
  return out
end

local function place(name, position, quality)
  local entity = surface.create_entity({ name = name, position = position, force = "player", quality = quality })
  if not entity then error("could not place " .. name) end
  return entity
end

local function insert_modules(entity, names, quality)
  local inventory = entity.get_module_inventory()
  for _, name in pairs(names or {}) do
    if not inventory or inventory.insert({ name = name, count = 1, quality = quality or "normal" }) ~= 1 then
      error({ skip = entity.name .. " does not take " .. name .. " in this mod set" })
    end
  end
end

-- A pole and an unlimited power source above the case. The pole reaches 32
-- tiles each way: the beacon ring and the craft grid fit.
local function power(at)
  place("gametest-pole", { at.x + 12, at.y - 6 })
  local source = place("electric-energy-interface", { at.x + 9, at.y - 6 })
  source.power_production = 1e9
  source.electric_buffer_size = 1e9
end

local function effects_of(entity)
  local e = entity.effects or {}
  return {
    speed = e.speed or 0,
    productivity = e.productivity or 0,
    consumption = e.consumption or 0,
    pollution = e.pollution or 0,
    quality = e.quality or 0,
  }
end

-- Each kind builds a case and returns a poll function. The scenario calls it
-- every tick until it returns the case's measurements.
local kinds = {}

function kinds.spoil(case)
  local ticks = {}
  for _, name in pairs(case.items) do
    ticks[name] = {}
    for _, quality in pairs(quality_chain()) do
      ticks[name][quality] = prototypes.item[name].get_spoil_ticks(quality)
    end
  end
  return function() return { ticks = ticks } end
end

function kinds.products(case)
  local recipes = {}
  for _, name in pairs(case.recipes) do
    local products = {}
    for i, p in pairs(prototypes.recipe[name].products) do
      products[i] = {
        name = p.name,
        amount = p.amount,
        ignored_by_productivity = p.ignored_by_productivity or 0,
      }
    end
    recipes[name] = products
  end
  return function() return { recipes = recipes } end
end

function kinds.effects(case, at)
  power(at)
  local machine = place(case.machine, at)
  insert_modules(machine, case.modules, case.module_quality)
  -- beacons ring the machine, edge to edge
  local machine_size = prototypes.entity[case.machine].tile_width
  local placed = 0
  for _, b in pairs(case.beacons or {}) do
    local d = (machine_size + prototypes.entity[b.name].tile_width) / 2
    local ring = { { -d, -d }, { 0, -d }, { d, -d }, { -d, 0 }, { d, 0 }, { -d, d }, { 0, d }, { d, d } }
    for _ = 1, b.count do
      placed = placed + 1
      local offset = ring[placed]
      local beacon = place(b.name, { at.x + offset[1], at.y + offset[2] }, b.quality)
      insert_modules(beacon, b.modules, b.module_quality)
    end
  end
  local wait = 2 -- effects settle a tick after placement
  return function()
    wait = wait - 1
    if wait > 0 then return nil end
    return { effects = effects_of(machine) }
  end
end

function kinds.craft(case, at)
  power(at)
  local recipe = prototypes.recipe[case.recipe]
  local count = case.machines or 1
  local jobs = {}
  for i = 1, count do
    local col, row = (i - 1) % 8, math.floor((i - 1) / 8)
    local machine = place(case.machine, { at.x + col * 4, at.y + row * 4 })
    machine.set_recipe(case.recipe)
    insert_modules(machine, case.modules, case.module_quality)
    jobs[i] = { machine = machine, left = case.crafts / count }
  end
  local tally = {}
  return function()
    local done = true
    for _, job in pairs(jobs) do
      local input = job.machine.get_inventory(defines.inventory.crafter_input)
      local output = job.machine.get_output_inventory()
      -- feed two crafts at a time so the machine rarely waits
      if job.left > 0 and input.is_empty() then
        local n = math.min(job.left, 2)
        for _, ingredient in pairs(recipe.ingredients) do
          input.insert({ name = ingredient.name, count = ingredient.amount * n })
        end
        job.left = job.left - n
      end
      for _, stack in pairs(output.get_contents()) do
        tally[stack.name] = tally[stack.name] or {}
        tally[stack.name][stack.quality] = (tally[stack.name][stack.quality] or 0) + stack.count
      end
      output.clear()
      if job.left > 0 or not input.is_empty() or job.machine.is_crafting() then done = false end
    end
    if not done then return nil end
    local bonus = 0
    for _, job in pairs(jobs) do bonus = bonus + job.machine.bonus_progress end
    return {
      crafts = case.crafts,
      products = tally,
      bonus_progress = bonus,
      effects = effects_of(jobs[1].machine),
    }
  end
end

-- Runs one call, turning a Lua error into the case's `error` (or `skipped`).
local function guarded(entry, fn, ...)
  local ok, value = pcall(fn, ...)
  if ok then return value end
  if type(value) == "table" and value.skip then
    entry.result = { skipped = value.skip }
  else
    entry.result = { error = tostring(value) }
  end
end

local entries

local function start()
  surface = game.create_surface("gametest", { default_enable_all_autoplace_controls = false })
  -- a craft only rolls up to qualities its force has unlocked
  for _, name in pairs(quality_chain()) do
    game.forces.player.unlock_quality(name)
  end
  entries = {}
  for i, case in pairs(cases) do
    entries[i] = { case = case, at = { x = i * SPACING + 0.5, y = 0.5 } }
    surface.request_to_generate_chunks(entries[i].at, 2)
  end
  surface.force_generate_chunk_requests()
  for _, entry in pairs(entries) do
    local case, at = entry.case, entry.at
    local skip = captured.missing[case.name]
    if skip then
      entry.result = { skipped = skip }
    else
      local area = { { at.x - 16, at.y - 16 }, { at.x + 48, at.y + 48 } }
      surface.build_checkerboard(area)
      for _, e in pairs(surface.find_entities(area)) do e.destroy() end
      entry.poll = guarded(entry, kinds[case.kind], case, at)
    end
  end
end

local function finish()
  local out, passed = {}, true
  for i, entry in pairs(entries) do
    local result = entry.result or { error = "timed out after " .. MAX_TICKS .. " ticks" }
    if result.error then passed = false end
    result.case = entry.case
    out[i] = result
  end
  helpers.write_file("results.json", helpers.table_to_json({ raw = captured.raw, cases = out }))
  script.finish_test(passed)
end

script.on_event(defines.events.on_tick, function(event)
  if not entries then start() end
  local pending = false
  for _, entry in pairs(entries) do
    if not entry.result and entry.poll then
      entry.result = guarded(entry, entry.poll) or entry.result
      if not entry.result then pending = true end
    end
  end
  if not pending or event.tick >= MAX_TICKS then
    finish()
    script.on_event(defines.events.on_tick, nil)
  end
end)
