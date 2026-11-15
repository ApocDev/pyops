-- Copies the prototypes the cases use, as data.raw has them after every mod
-- ran, into a mod-data prototype. The scenario writes them next to its
-- measurements, so the app's tests import exactly what the engine loaded.
-- This mod depends on pypostprocessing (optionally), so it runs after Py's
-- final fixes.

local cases = require("cases")

-- the data.raw types a case's names can come from
local types = {
  entity = { "assembling-machine", "furnace", "beacon" },
  item = { "item", "module" },
  recipe = { "recipe" },
  quality = { "quality" },
}

-- Graphics and sounds: tables with a filename, and icon fields.
local function strip(value)
  if type(value) ~= "table" then return value end
  if value.filename or value.filenames then return nil end
  local out, any = {}, false
  for k, v in pairs(value) do
    any = true
    if k ~= "icon" and k ~= "icons" then out[k] = strip(v) end
  end
  -- a table emptied by the strip goes too; one that was empty stays ({} can mean "none")
  if any and next(out) == nil then return nil end
  return out
end

local raw, missing = {}, {}

local function capture(case, kind, name)
  if not name then return end
  for _, t in pairs(types[kind]) do
    local proto = data.raw[t] and data.raw[t][name]
    if proto then
      raw[t] = raw[t] or {}
      raw[t][name] = strip(proto)
      return
    end
  end
  missing[case.name] = missing[case.name] or (kind .. " " .. name .. " is not in this mod set")
end

for name, quality in pairs(data.raw.quality) do
  raw.quality = raw.quality or {}
  raw.quality[name] = strip(quality)
end

for _, case in pairs(cases) do
  capture(case, "entity", case.machine)
  capture(case, "recipe", case.recipe)
  capture(case, "quality", case.module_quality)
  for _, name in pairs(case.modules or {}) do capture(case, "item", name) end
  for _, name in pairs(case.items or {}) do capture(case, "item", name) end
  for _, name in pairs(case.recipes or {}) do capture(case, "recipe", name) end
  for _, beacon in pairs(case.beacons or {}) do
    capture(case, "entity", beacon.name)
    capture(case, "quality", beacon.quality)
    capture(case, "quality", beacon.module_quality)
    for _, name in pairs(beacon.modules) do capture(case, "item", name) end
  end
end

data:extend({ { type = "mod-data", name = "pyops-gametest", data = { raw = raw, missing = missing } } })
