-- PyOps companion: UDP bridge to the PyOps planner app.
-- Rolled back to the bridge core (connect / ping / pong). Task, milestone and
-- live-state messages layer on top of send_request / handle_bridge_response.
--
-- Transport: localhost UDP via Factorio's helpers.send_udp / recv_udp. The game
-- must be launched with `--enable-lua-udp <port>` (default 37657), and the
-- bridge must be enabled in the per-player mod settings.

local mod_gui = require("__core__.lualib.mod-gui")
local Summary = require("summary")
local Combinator = require("combinator")
local Tasks = require("tasks")

local PANEL_NAME = "pyops_panel"
local BUTTON_NAME = "pyops_button"
local SHORTCUT_NAME = "pyops-toggle-panel"
-- Bridge wire contract. Keep in lockstep with PROTOCOL_VERSION in the app's
-- src/server/bridge/protocol.ts — each side warns if the other reports a different one.
local PROTOCOL_VERSION = 5

local function get_player(event)
  if not event.player_index then
    return nil
  end

  return game.get_player(event.player_index)
end

local function get_bridge_port(player)
  return settings.get_player_settings(player)["pyops-bridge-port"].value
end

local function is_bridge_enabled(player)
  return settings.get_player_settings(player)["pyops-bridge-enabled"].value
end

local function get_panel(player)
  if not player or not player.valid then
    return nil
  end

  return player.gui.screen[PANEL_NAME]
end

local function find_child(parent, name)
  if not parent then
    return nil
  end

  if parent.name == name then
    return parent
  end

  for _, child in pairs(parent.children or {}) do
    local match = find_child(child, name)
    if match then
      return match
    end
  end

  return nil
end

local function set_shortcut_state(player, toggled)
  if player and player.valid then
    player.set_shortcut_toggled(SHORTCUT_NAME, toggled)
  end
end

local function set_status(player, caption)
  local status = find_child(get_panel(player), "status")
  if status then
    status.caption = caption
  end
end

-- Connection dot in the titlebar (replaces the old status strip). Click pings.
local LED = {
  connected = { "60,220,90", "Connected" },
  disconnected = { "220,80,80", "Not connected" },
  mismatch = { "230,180,60", "Protocol version mismatch" },
}
local function set_led(player, state)
  local led = find_child(get_panel(player), "pyops_led")
  if not led then
    return
  end
  local s = LED[state] or LED.disconnected
  led.caption = "[color=" .. s[1] .. "]●[/color]"
  led.tooltip = s[2] .. " · click to refresh"
end

local function destroy_panel(player)
  local panel = get_panel(player)
  if panel then
    panel.destroy()
  end

  set_shortcut_state(player, false)
end

-- ── UDP bridge ───────────────────────────────────────────────────────────────

-- Send a JSON request to the app. `payload` is an optional table. Future message
-- types (state.research, todo.*, …) reuse this same envelope.
local function send_request(player, request_type, payload)
  if not is_bridge_enabled(player) then
    set_status(player, {"pyops.status-disabled"})
    return false
  end

  local message = helpers.table_to_json({
    protocol_version = PROTOCOL_VERSION,
    type = request_type,
    request_id = tostring(game.tick) .. "-" .. player.index .. "-" .. request_type,
    tick = game.tick,
    player = player.name,
    mod_version = script.active_mods["pyops"],
    payload = payload
  })

  helpers.send_udp(get_bridge_port(player), message, player.index)
  return true
end

-- Let the Tasks module send app requests (task.list / task.capture) without a
-- circular require back into control.lua.
Tasks.send = function(player, request_type, payload)
  send_request(player, request_type, payload)
end

-- Reply to an app→mod request (a `cmd.*` the app pushed with a request_id). We
-- echo that request_id in a `bridge.result` so the app correlates it back to the
-- awaiting caller (see server/bridge/inspect.ts).
local function send_reply(player, reply_to, payload)
  if not is_bridge_enabled(player) then
    return
  end
  local message = helpers.table_to_json({
    protocol_version = PROTOCOL_VERSION,
    type = "bridge.result",
    request_id = reply_to,
    tick = game.tick,
    player = player.name,
    payload = payload
  })
  helpers.send_udp(get_bridge_port(player), message, player.index)
end

-- Manual / on-open ping shows progress; the heartbeat pings silently.
local function ping(player, silent)
  if not silent then
    set_status(player, {"pyops.status-refreshing"})
  end
  send_request(player, "bridge.ping")
end

-- Push the player's researched technologies so the app knows what's actually
-- unlocked. Sent on connect and whenever research finishes; the full set each
-- time (authoritative — no delta merging on the app side).
local function send_research(player)
  local force = player.force
  if not (force and force.valid) then
    return
  end

  local researched = {}
  for name, tech in pairs(force.technologies) do
    if tech.researched then
      researched[#researched + 1] = name
    end
  end

  send_request(player, "state.research", {
    force = force.name,
    researched = researched
  })
end

-- Push the player's TURD selections (master tech -> chosen sub-tech). Read from
-- pyalienlife's pywiki_turd_page remote interface; entries that are still the
-- NOT_SELECTED sentinel (an integer) are skipped. No-op if the interface isn't
-- present (pyalienlife missing or too old).
local function send_turd(player)
  local force = player.force
  if not (force and force.valid) then
    return
  end

  local iface = remote.interfaces["pywiki_turd_page"]
  if not (iface and iface["get_turd_selections"]) then
    return
  end

  local raw = remote.call("pywiki_turd_page", "get_turd_selections", force.index) or {}
  local selections = {}
  for master, sub in pairs(raw) do
    if type(sub) == "string" then -- a real choice (skip the NOT_SELECTED integer)
      selections[master] = sub
    end
  end

  send_request(player, "state.turd", { force = force.name, selections = selections })
end

-- Machine prototype types the planner models — must match the entity "kind"s the
-- solver assigns recipes to (crafting_machines.kind in the app). Py's production/
-- creature buildings are assembling-machine/furnace prototypes, so a type scan
-- catches them by name.
local MACHINE_TYPES = {
  "assembling-machine",
  "furnace",
  "rocket-silo",
  "mining-drill",
  "boiler",
  "generator",
  "reactor",
  "offshore-pump",
}
-- Types whose entities expose a craftable recipe we can read (assemblers, chem
-- plants/refineries are all "assembling-machine"; furnaces auto-pick one). Mining
-- drills have no recipe but DO have a resource target — those are keyed by the
-- solver's synthetic `mine-<resource>` recipe (see below). Everything else (boilers,
-- generators, pumps, reactors) reports the empty bucket and compares at machine-total.
local RECIPE_TYPES = { ["assembling-machine"] = true, ["furnace"] = true, ["rocket-silo"] = true }

-- Reverse map of entity-status enum → name, so inspect tools can report a
-- readable status ("working", "item_ingredient_shortage", …) to the app.
local STATUS_NAME = {}
for status_name, value in pairs(defines.entity_status) do
  STATUS_NAME[value] = status_name
end

-- Push how many of each machine the player has actually placed, keyed by the
-- recipe each is set to craft. One full scan of the force's entities across all
-- surfaces (a follow-up will maintain this incrementally via on_built/on_mined).
-- Authoritative full snapshot, like research/TURD — the app replaces, never merges.
local function send_built_machines(player)
  local force = player.force
  if not (force and force.valid) then
    return
  end

  -- counts[machine_name][recipe_name] = n  (recipe "" = idle/none/no-recipe)
  local counts = {}
  for _, surface in pairs(game.surfaces) do
    local entities = surface.find_entities_filtered({ force = force, type = MACHINE_TYPES })
    for _, e in pairs(entities) do
      if e.valid then
        local recipe = ""
        if RECIPE_TYPES[e.type] then
          local ok, r = pcall(e.get_recipe)
          if ok and r then
            recipe = r.name
          end
        elseif e.type == "mining-drill" then
          -- Key a drill by the resource it's on, matching the solver's synthetic
          -- `mine-<resource>` recipe so built-vs-required lines up per ore. An idle
          -- drill (no target / depleted patch) falls back to the machine-total bucket.
          local ok, target = pcall(function()
            return e.mining_target
          end)
          if ok and target and target.valid then
            recipe = "mine-" .. target.name
          end
        end
        local byRecipe = counts[e.name]
        if not byRecipe then
          byRecipe = {}
          counts[e.name] = byRecipe
        end
        byRecipe[recipe] = (byRecipe[recipe] or 0) + 1
      end
    end
  end

  -- Flatten to a list so the empty-recipe key survives JSON (and avoids an
  -- empty-table-as-array ambiguity on the app side).
  local machines = {}
  for name, byRecipe in pairs(counts) do
    for recipe, n in pairs(byRecipe) do
      machines[#machines + 1] = { machine = name, recipe = recipe, count = n }
    end
  end

  send_request(player, "state.built", { force = force.name, machines = machines })
end

-- Live production statistics. Factorio 2.0 exposes flow stats per surface, so we
-- sum each good's rate across all surfaces. For production statistics, category
-- "input" = produced, "output" = consumed; get_flow_count(count=false) is
-- normalized PER MINUTE for item/fluid stats, so /60 gives per-second.
local STATS_PRECISION = defines.flow_precision_index.one_minute

local function accumulate_flow(stats, kind, acc)
  if not stats then
    return
  end

  local names = {}
  for name in pairs(stats.input_counts) do
    names[name] = true
  end
  for name in pairs(stats.output_counts) do
    names[name] = true
  end

  for name in pairs(names) do
    local produced = stats.get_flow_count({
      name = name, category = "input", precision_index = STATS_PRECISION, count = false
    }) / 60
    local consumed = stats.get_flow_count({
      name = name, category = "output", precision_index = STATS_PRECISION, count = false
    }) / 60
    if produced > 1e-6 or consumed > 1e-6 then
      local e = acc[name]
      if not e then
        e = { name = name, kind = kind, produced = 0, consumed = 0 }
        acc[name] = e
      end
      e.produced = e.produced + produced
      e.consumed = e.consumed + consumed
    end
  end
end

-- Push the factory's actual per-second production/consumption. Unlike research/
-- TURD/built (event-driven), stats vary continuously, so this also fires on a slow
-- timer while the panel is open (see on_nth_tick below).
local function send_stats(player)
  local force = player.force
  if not (force and force.valid) then
    return
  end

  local acc = {}
  for _, surface in pairs(game.surfaces) do
    accumulate_flow(force.get_item_production_statistics(surface), "item", acc)
    accumulate_flow(force.get_fluid_production_statistics(surface), "fluid", acc)
  end

  local items = {}
  for _, e in pairs(acc) do
    items[#items + 1] = e
  end

  send_request(player, "state.stats", { force = force.name, items = items })
end

-- On-demand: push all current live state now (research + TURD). Used by the
-- panel's Sync button and the app's request.sync. A ping refreshes the
-- connection status alongside.
local function sync_state(player)
  set_status(player, {"pyops.status-syncing"})
  send_research(player)
  send_turd(player)
  send_built_machines(player)
  send_stats(player)
  send_request(player, "bridge.ping")
end

-- App command: locate a good in the world. Relays to the Factory Search mod,
-- which finds producers / storage / consumers and lets the player zoom to each.
-- If Factory Search isn't installed we tell the player rather than fail silently.
local function locate_good(player, payload)
  if not (payload and type(payload.name) == "string") then
    return
  end

  local iface = remote.interfaces["factory-search"]
  if iface and iface["search"] then
    local kind = payload.kind == "fluid" and "fluid" or "item"
    remote.call("factory-search", "search", player, { name = payload.name, type = kind })
  else
    player.print({"pyops.locate-no-factory-search"})
  end
end

-- ── Read-only game-world inspection (app → mod cmd.* → reply) ──────────────────
-- All bounded and structured: the app's assistant tools call these to ground a
-- task in live evidence. No whole-map dumps.

-- Per-second produced/consumed for a good from a flow-statistics object. pcall'd
-- because passing an item name to fluid stats (or vice versa) can error.
local function flow_of(stats, name, category)
  if not stats then
    return 0
  end
  local ok, value = pcall(stats.get_flow_count, {
    name = name, category = category, precision_index = STATS_PRECISION, count = false
  })
  return (ok and value or 0) / 60
end

-- Read a crafting machine's current recipe name (nil for non-crafters).
local function recipe_of(entity)
  if not RECIPE_TYPES[entity.type] then
    return nil
  end
  local ok, recipe = pcall(entity.get_recipe)
  if ok and recipe then
    return recipe.name
  end
  return nil
end

local function entity_brief(entity)
  return {
    name = entity.name,
    type = entity.type,
    x = entity.position.x,
    y = entity.position.y,
    recipe = recipe_of(entity),
    status = STATUS_NAME[entity.status]
  }
end

-- The player's surface/position/force and the entity they're selecting (falling
-- back to the last entity they hovered, since the cursor sits on the GUI).
local function game_context(player)
  local selected = nil
  if player.selected and player.selected.valid then
    selected = entity_brief(player.selected)
  else
    local cache = storage.pyops_last_selected
    if cache and cache[player.index] then
      selected = cache[player.index]
    end
  end
  return {
    player = player.name,
    force = player.force.name,
    surface = player.surface.name,
    x = player.position.x,
    y = player.position.y,
    tick = game.tick,
    selected = selected
  }
end

-- Entities the player's force has built inside a box (capped). Excludes the player.
local function inspect_area(player, payload)
  payload = payload or {}
  local surface = (payload.surface and game.surfaces[payload.surface]) or player.surface
  local cx = tonumber(payload.x) or player.position.x
  local cy = tonumber(payload.y) or player.position.y
  local radius = math.min(math.max(tonumber(payload.radius) or 16, 1), 64)
  local found = surface.find_entities_filtered({
    area = { { cx - radius, cy - radius }, { cx + radius, cy + radius } },
    force = player.force,
    limit = 60
  })
  local entities = {}
  for _, e in pairs(found) do
    if e.valid and e.type ~= "character" then
      entities[#entities + 1] = entity_brief(e)
    end
  end
  return {
    surface = surface.name,
    center = { x = cx, y = cy },
    radius = radius,
    count = #entities,
    truncated = #found >= 60,
    entities = entities
  }
end

-- Count + sample positions of a given entity prototype on a surface (capped).
local function find_entities(player, payload)
  payload = payload or {}
  if type(payload.name) ~= "string" then
    return { ok = false, error = "missing entity name" }
  end
  local surface = (payload.surface and game.surfaces[payload.surface]) or player.surface
  local limit = math.min(math.max(tonumber(payload.limit) or 20, 1), 50)
  local all = surface.find_entities_filtered({ name = payload.name, force = player.force })
  local sample = {}
  for i = 1, math.min(#all, limit) do
    sample[#sample + 1] = { x = all[i].position.x, y = all[i].position.y }
  end
  return {
    name = payload.name,
    surface = surface.name,
    count = #all,
    truncated = #all > limit,
    sample = sample
  }
end

-- Live per-second production/consumption for specific goods (force-wide).
local function production(player, payload)
  payload = payload or {}
  if type(payload.goods) ~= "table" then
    return { stats = {} }
  end
  local force = player.force
  local out = {}
  for _, name in pairs(payload.goods) do
    if type(name) == "string" then
      local produced, consumed = 0, 0
      for _, surface in pairs(game.surfaces) do
        local istats = force.get_item_production_statistics(surface)
        local fstats = force.get_fluid_production_statistics(surface)
        produced = produced + flow_of(istats, name, "input") + flow_of(fstats, name, "input")
        consumed = consumed + flow_of(istats, name, "output") + flow_of(fstats, name, "output")
      end
      out[#out + 1] = { name = name, produced = produced, consumed = consumed }
    end
  end
  return { stats = out }
end

-- ── Debug Lua eval (app → mod cmd.eval) ───────────────────────────────────────
-- Run arbitrary Lua sent from the app/MCP and return a readable repr of the
-- result. This is a DEBUG aid (full game access, can mutate state) — single-player
-- only; running network-driven code can desync multiplayer.

-- A bounded, JSON-free string repr that survives LuaObjects (entities, etc.),
-- which can't be json-encoded. Caps breadth + depth so a huge table can't explode.
local function lua_repr(value, depth)
  depth = depth or 0
  local t = type(value)
  if t == "string" then
    return string.format("%q", value)
  elseif t ~= "table" then
    return tostring(value)
  end
  if depth >= 4 then
    return "{...}"
  end
  -- LuaObjects expose .object_name; show a compact tag with name/type if present.
  local is_obj, oname = pcall(function() return value.object_name end)
  if is_obj and oname then
    local tag = tostring(oname)
    local okn, nm = pcall(function() return value.name end)
    if okn and nm then tag = tag .. " " .. tostring(nm) end
    return "<" .. tag .. ">"
  end
  local parts, n = {}, 0
  for k, v in pairs(value) do
    n = n + 1
    if n > 40 then
      parts[#parts + 1] = "..."
      break
    end
    parts[#parts + 1] = tostring(k) .. "=" .. lua_repr(v, depth + 1)
  end
  return "{" .. table.concat(parts, ", ") .. "}"
end

local function eval_lua(player, payload)
  payload = payload or {}
  local code = payload.code
  if type(code) ~= "string" or code == "" then
    return { ok = false, error = "missing code" }
  end
  if not load then
    return { ok = false, error = "load() is unavailable in this Lua sandbox" }
  end
  -- `player` and `game` are pre-bound; everything else falls through to globals.
  local env = setmetatable({ player = player }, { __index = _G })
  -- Try as an expression first (so "game.tick" returns), then as statements.
  local fn, err = load("return " .. code, "pyops-eval", "t", env)
  if not fn then
    fn, err = load(code, "pyops-eval", "t", env)
  end
  if not fn then
    return { ok = false, error = "compile error: " .. tostring(err) }
  end
  local ok, result = pcall(fn)
  if not ok then
    return { ok = false, error = "runtime error: " .. tostring(result) }
  end
  local repr = lua_repr(result, 0)
  if #repr > 8000 then
    repr = repr:sub(1, 8000) .. "…(truncated)"
  end
  return { ok = true, result = repr }
end

local function schedule_reload_mods(player, request_id, payload)
  payload = payload or {}
  if payload.confirm ~= "reload_mods" then
    send_reply(player, request_id, {
      ok = false,
      error = "missing confirm='reload_mods'"
    })
    return
  end

  storage.pyops_dev_reload_mods_at = game.tick + 1
  send_reply(player, request_id, {
    ok = true,
    scheduled_tick = storage.pyops_dev_reload_mods_at
  })
end

local function handle_bridge_response(player, response)
  if not response or not response.type then
    set_status(player, {"pyops.status-error", "invalid response"})
    return
  end

  if response.type == "bridge.pong" then
    -- protocol handshake: the app echoes its contract version in the pong
    local app_version = response.protocol_version
    if app_version and app_version ~= PROTOCOL_VERSION then
      set_led(player, "mismatch")
    else
      set_led(player, "connected")
    end
  elseif response.type == "request.sync" then
    -- the app asked us to push current state (its "Pull from game" button)
    sync_state(player)
  elseif response.type == "cmd.locate" then
    -- the app asked us to find a good in the world (web "locate in game" button)
    locate_good(player, response.payload)
  elseif response.type == "cmd.show_block" then
    -- the app pushed a solved block to render as an in-game build sheet
    Summary.show(player, response.payload)
  elseif response.type == "task.list" then
    -- the app sent the project's tasks → store + re-render the panel
    local payload = response.payload or {}
    Tasks.set_data(payload.tasks)
    Tasks.refresh(player)
  elseif response.type == "task.captured" then
    -- the app confirmed a task was filed → pull the refreshed list
    local payload = response.payload or {}
    if not payload.ok then
      set_status(player, {"pyops.status-error", payload.error or "capture failed"})
    end
    send_request(player, "task.list", {})
  elseif response.type == "cmd.game_context" then
    send_reply(player, response.request_id, game_context(player))
  elseif response.type == "cmd.inspect_area" then
    send_reply(player, response.request_id, inspect_area(player, response.payload))
  elseif response.type == "cmd.find_entities" then
    send_reply(player, response.request_id, find_entities(player, response.payload))
  elseif response.type == "cmd.production" then
    send_reply(player, response.request_id, production(player, response.payload))
  elseif response.type == "cmd.eval" then
    send_reply(player, response.request_id, eval_lua(player, response.payload))
  elseif response.type == "cmd.dev.reload_mods" then
    schedule_reload_mods(player, response.request_id, response.payload)
  elseif response.type == "error" then
    local message = response.payload and response.payload.message or "unknown"
    set_status(player, {"pyops.status-error", message})
  end
  -- (future) cmd.show_block / todo.* / milestone.* commands dispatch from here.
end

-- ── Panel ─────────────────────────────────────────────────────────────────────

local function create_panel(player)
  local panel = player.gui.screen.add({
    type = "frame",
    name = PANEL_NAME,
    direction = "vertical"
  })
  panel.auto_center = true
  -- Size to most of the screen (a gui.screen frame otherwise hugs its content).
  local res, scale = player.display_resolution, player.display_scale
  panel.style.width = math.floor(res.width / scale * 0.6)
  panel.style.height = math.floor(res.height / scale * 0.72)

  -- Titlebar: title, connection LED (click = ping), drag handle, close.
  local titlebar = panel.add({
    type = "flow",
    name = "pyops_titlebar",
    direction = "horizontal"
  })
  titlebar.drag_target = panel
  titlebar.style.horizontal_spacing = 8

  titlebar.add({
    type = "label",
    caption = {"pyops.panel-title"},
    style = "frame_title",
    ignored_by_interaction = true
  })
  local led = titlebar.add({
    type = "label",
    name = "pyops_led",
    caption = "[color=220,80,80]●[/color]",
    tooltip = "Not connected · click to refresh"
  })
  led.style.top_margin = 4

  local drag_handle = titlebar.add({
    type = "empty-widget",
    style = "draggable_space_header",
    ignored_by_interaction = true
  })
  drag_handle.style.horizontally_stretchable = true
  drag_handle.style.height = 24
  drag_handle.style.right_margin = 4

  titlebar.add({
    type = "sprite-button",
    name = "pyops_close_panel",
    sprite = "utility/close",
    tooltip = {"pyops.open-tooltip"},
    style = "frame_action_button"
  })

  -- Tabs: Tasks (live) + Blocks (placeholder for now).
  local tp = panel.add({ type = "tabbed-pane" })
  tp.style.horizontally_stretchable = true
  tp.style.vertically_stretchable = true
  local tasks_tab = tp.add({ type = "tab", caption = "Tasks" })
  local blocks_tab = tp.add({ type = "tab", caption = "Blocks" })

  local tasks_content = tp.add({ type = "flow", name = "pyops_tasks_tab", direction = "vertical" })
  tp.add_tab(tasks_tab, tasks_content)
  Tasks.build(player, tasks_content)

  local blocks_content = tp.add({ type = "flow", direction = "vertical" })
  tp.add_tab(blocks_tab, blocks_content)
  blocks_content.style.padding = 8
  blocks_content.add({ type = "label", style = "pyops_muted", caption = "(Blocks viewer — coming soon.)" })

  set_shortcut_state(player, true)
  ping(player)
  send_research(player) -- push current state on connect
  send_turd(player)
  send_built_machines(player)
  send_stats(player)
  send_request(player, "task.list", {}) -- pull the project's tasks to render
end

local function toggle_panel(player)
  if not player or not player.valid then
    return
  end

  if get_panel(player) then
    destroy_panel(player)
  else
    create_panel(player)
  end
end

local function ensure_mod_gui_button(player)
  local flow = mod_gui.get_button_flow(player)
  if flow[BUTTON_NAME] then
    return
  end

  flow.add({
    type = "sprite-button",
    name = BUTTON_NAME,
    sprite = "utility/logistic_network_panel_white",
    tooltip = {"pyops.open-tooltip"},
    style = mod_gui.button_style
  })
end

-- ── Events ─────────────────────────────────────────────────────────────────────

script.on_init(function()
  for _, player in pairs(game.players) do
    ensure_mod_gui_button(player)
  end
end)

script.on_event(defines.events.on_player_created, function(event)
  local player = get_player(event)
  if player then
    ensure_mod_gui_button(player)
  end
end)

script.on_event(defines.events.on_lua_shortcut, function(event)
  if event.prototype_name ~= SHORTCUT_NAME then
    return
  end

  toggle_panel(get_player(event))
end)

script.on_event("pyops-toggle-panel", function(event)
  toggle_panel(get_player(event))
end)

script.on_event(defines.events.on_gui_click, function(event)
  local player = get_player(event)
  if not player or not event.element or not event.element.valid then
    return
  end

  -- the block summary panel handles its own buttons (close + blueprint rows)
  if Summary.on_gui_click(player, event.element) then
    return
  end

  -- the request-combinator dialog handles its own buttons
  if Combinator.on_gui_click(player, event.element) then
    return
  end

  -- the Tasks panel + New-task dialog handle their own buttons
  if Tasks.on_gui_click(player, event.element) then
    return
  end

  local name = event.element.name
  if name == BUTTON_NAME then
    toggle_panel(player)
  elseif name == "pyops_close_panel" then
    destroy_panel(player)
  elseif name == "pyops_led" then
    ping(player)
  end
end)

-- Enter in the New-task dialog's title field files the task.
script.on_event(defines.events.on_gui_confirmed, function(event)
  local player = get_player(event)
  if player and event.element and event.element.valid and event.element.name == "pyops_nt_title" then
    Tasks.submit_new(player)
  end
end)

-- Remember the entity the player is hovering, so a capture made from the panel
-- (cursor on the GUI, nothing selected) can still anchor to what they were
-- looking at. Stored as plain fields (not an entity ref) so it persists safely.
script.on_event(defines.events.on_selected_entity_changed, function(event)
  local player = game.get_player(event.player_index)
  if not (player and player.selected and player.selected.valid) then
    return
  end
  storage.pyops_last_selected = storage.pyops_last_selected or {}
  local e = player.selected
  storage.pyops_last_selected[player.index] = {
    name = e.name,
    type = e.type,
    x = e.position.x,
    y = e.position.y,
    surface = e.surface.name
  }
end)

-- Request-combinator planner: the player dragged the selection tool over their
-- station + holding storage. Measure it and open the sizing dialog. (alt-select
-- behaves the same — both just gather entities.)
local function on_planner_selection(event)
  if event.item ~= Combinator.TOOL_NAME then
    return
  end
  local player = game.get_player(event.player_index)
  if player then
    Combinator.on_selected(player, event.entities)
  end
end
script.on_event(defines.events.on_player_selected_area, on_planner_selection)
script.on_event(defines.events.on_player_alt_selected_area, on_planner_selection)

-- Storage-group checkboxes in the request-combinator dialog.
script.on_event(defines.events.on_gui_checked_state_changed, function(event)
  local player = get_player(event)
  if player and event.element and event.element.valid then
    Combinator.on_gui_checked(player, event.element)
  end
end)

-- Fluid-chain → fluid dropdowns in the request-combinator dialog.
script.on_event(defines.events.on_gui_selection_state_changed, function(event)
  local player = get_player(event)
  if player and event.element and event.element.valid then
    Combinator.on_gui_selection(player, event.element)
  end
end)

-- Track which summary cell the cursor is over, so the pipette key can act on it.
script.on_event(defines.events.on_gui_hover, function(event)
  local player = get_player(event)
  if player and event.element and event.element.valid then
    Summary.on_hover(player, event.element)
  end
end)
script.on_event(defines.events.on_gui_leave, function(event)
  local player = get_player(event)
  if player and event.element and event.element.valid then
    Summary.on_leave(player, event.element)
  end
end)

-- Smart-pipette (Q) over a summary cell puts that good/building on the cursor.
-- pcall-guarded: a newly added custom-input only exists after the data stage
-- re-runs (a full reload), so binding it must not crash on a partial reload.
pcall(script.on_event, "pyops-pipette", function(event)
  local player = game.get_player(event.player_index)
  if player then
    Summary.pipette(player)
  end
end)

-- Toggle the copyable debug panel (CTRL+SHIFT+D). Guarded with pcall: a newly added
-- custom-input only exists after the data stage re-runs (a full reload), so binding
-- it must not crash control.lua during an inconsistent partial reload.
pcall(script.on_event, "pyops-toggle-debug", function(event)
  local player = game.get_player(event.player_index)
  if player then
    Combinator.toggle_debug(player)
  end
end)

-- Research changed — push the new full set to the app (panel need not be open).
script.on_event(defines.events.on_research_finished, function(event)
  local force = event.research and event.research.force
  if not force then
    return
  end

  for _, player in pairs(game.connected_players) do
    if player.force == force and is_bridge_enabled(player) then
      send_research(player)
    end
  end
end)

script.on_event(defines.events.on_tick, function()
  local at = storage.pyops_dev_reload_mods_at
  if at and game.tick >= at then
    storage.pyops_dev_reload_mods_at = nil
    game.reload_mods()
  end
end)

-- The bridge runs whenever it's enabled in settings — NOT only while the in-game
-- panel is open. The panel is just a status surface (set_status is a no-op when
-- it's closed); the user typically keeps the web UI open and the panel closed.

-- Poll for incoming bridge packets (~twice a second) so the app's request.sync /
-- "pull from game" is picked up even with the panel closed.
script.on_nth_tick(30, function()
  for _, player in pairs(game.connected_players) do
    if is_bridge_enabled(player) then
      helpers.recv_udp(player.index)
    end
  end
end)

-- Set true every time control.lua loads — i.e. on every save load/switch (and new
-- game). The next heartbeat flushes a full state resync so the app reflects the
-- LOADED save, not the previous world: research (which drives availability), TURD,
-- built counts, and stats. All four are full-replace on the app side, so re-pushing
-- is idempotent — no diffing needed.
local pending_resync = true

-- Heartbeat: keep the connection fresh so the app shows connected (~every 2s). On
-- the first beat after a load, push a full resync instead of a bare ping.
script.on_nth_tick(120, function()
  local synced = false
  for _, player in pairs(game.connected_players) do
    if is_bridge_enabled(player) then
      if pending_resync then
        sync_state(player)
        synced = true
      else
        ping(player, true)
      end
    end
  end
  if synced then
    pending_resync = false
  end
end)

-- Live stats refresh: production rates change continuously, so re-push them on a
-- slow timer (~every 10s) so the app's actual/s stays live while the web UI is open.
script.on_nth_tick(600, function()
  for _, player in pairs(game.connected_players) do
    if is_bridge_enabled(player) then
      send_stats(player)
    end
  end
end)

script.on_event(defines.events.on_udp_packet_received, function(event)
  local player = get_player(event)
  if not player or not is_bridge_enabled(player) then
    return
  end

  local response = helpers.json_to_table(event.payload)
  if not response then
    set_status(player, {"pyops.status-error", "invalid JSON from bridge"})
    return
  end

  handle_bridge_response(player, response)
end)

-- Test harness: when the `factorio-test` mod is present (CI / on-demand), hand it
-- our suite to run in-game. Inert in normal play — `factorio-test` is never a
-- runtime dependency, so this branch is dead unless you explicitly add it.
-- See mod/tests/README.md.
if script.active_mods["factorio-test"] then
  require("__factorio-test__/init")({ "tests/combinator-test" }, {})
end
