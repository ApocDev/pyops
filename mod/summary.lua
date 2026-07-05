-- PyOps in-game block summary: a Helmod-style production-block matrix pushed from
-- the web app (cmd.show_block). Each recipe is a row — its products, its factory
-- (with count) and its ingredients shown as icon cells with number overlays. The
-- factory cell is clickable: it puts a configured blueprint (recipe set, modules
-- inserted) on the cursor so you can stamp the planned block down without
-- re-entering anything by hand.

local Combinator = require("combinator")

local Summary = {}

local PANEL_NAME = "pyops_summary"
local COMBINATOR_NAME = "pyops_sum_combinator"
local CLOSE_NAME = "pyops_sum_close"
local MAX_NAME = "pyops_sum_max"
local MIN_NAME = "pyops_sum_min"
local LOGI_NAME = "pyops_sum_logi"

-- Per-player panel state: the last payload (so we can rebuild on maximize) and
-- whether the window is expanded. Factorio has no drag-resize, so maximize is the
-- standard "make it bigger" affordance.
local function state_for(player)
  storage.pyops_summary = storage.pyops_summary or {}
  local s = storage.pyops_summary[player.index]
  if not s then
    s = { maximized = false }
    storage.pyops_summary[player.index] = s
  end
  return s
end

-- Precise rate for tooltips.
local function fmt_rate(rate)
  if rate >= 100 then
    return string.format("%.1f", rate)
  elseif rate >= 1 then
    return string.format("%.2f", rate)
  end
  return string.format("%.3f", rate)
end

-- Compact number for the cell label: integers plain, sub-1 with just enough
-- decimals, trailing zeros trimmed (so 1→"1", 0.10→"0.1", 0.06→"0.06").
local function fmt_num(n)
  if not n or n <= 0 then
    return ""
  end
  if n >= 100 or n == math.floor(n) then
    return string.format("%.0f", n)
  end
  local s = (n >= 1) and string.format("%.1f", n) or string.format("%.2f", n)
  s = s:gsub("0+$", "")
  s = s:gsub("%.$", "")
  return s
end

-- Belt/inserter counts: like fmt_num but never collapses a tiny non-zero count to
-- "0" (that reads as "none"); shows "<0.01" instead.
local function fmt_logi(n)
  if not n or n <= 0 then
    return ""
  end
  if n < 0.01 then
    return "<0.01"
  end
  return fmt_num(n)
end

-- Larger amount for storage tooltips (a 5-minute buffer is often thousands):
-- integers under 10k stay exact, bigger numbers compress to "k".
local function fmt_amount(n)
  if n >= 10000 then
    local s = string.format("%.1f", n / 1000):gsub("%.0$", "")
    return s .. "k"
  end
  return string.format("%.0f", n)
end

-- A sprite path the engine can actually resolve, or nil. Tries the good's own kind
-- first, then the other (recipe names can collide with items, etc.).
local function valid_sprite(kind, name)
  local candidates
  if kind == "fluid" then
    candidates = { "fluid/" .. name, "item/" .. name }
  elseif kind == "recipe" then
    candidates = { "recipe/" .. name, "item/" .. name, "fluid/" .. name }
  elseif kind == "entity" then
    candidates = { "entity/" .. name, "item/" .. name }
  else
    candidates = { "item/" .. name, "fluid/" .. name }
  end
  for _, path in ipairs(candidates) do
    if helpers.is_valid_sprite_path(path) then
      return path
    end
  end
  return nil
end

-- ── Blueprint ────────────────────────────────────────────────────────────────

local function module_inventory_for(entity_name)
  local proto = prototypes.entity[entity_name]
  local t = proto and proto.type
  if t == "furnace" then
    return defines.inventory.furnace_modules
  elseif t == "mining-drill" then
    return defines.inventory.mining_drill_modules
  elseif t == "lab" then
    return defines.inventory.lab_modules
  elseif t == "rocket-silo" then
    return defines.inventory.rocket_silo_modules
  elseif t == "beacon" then
    return defines.inventory.beacon_modules
  end
  return defines.inventory.assembling_machine_modules
end

-- Put a single configured machine on the cursor as a blueprint. Recipe is always
-- set (the real copy-paste win); modules are best-effort and degrade to a
-- recipe-only blueprint if the engine rejects the insert plan.
local function give_blueprint(player, build)
  local cursor = player.cursor_stack
  if not cursor then
    return
  end
  if not (build.machine and prototypes.entity[build.machine]) then
    player.print({ "", "PyOps: unknown machine '", tostring(build.machine), "'" })
    return
  end

  local proto = prototypes.entity[build.machine]
  local can_set_recipe = proto and (proto.type == "assembling-machine" or proto.type == "rocket-silo")

  local function set_entities(with_modules)
    cursor.set_stack({ name = "blueprint" })
    local entity = { entity_number = 1, name = build.machine, position = { 0, 0 } }
    if can_set_recipe and build.recipe and build.recipe ~= "" and prototypes.recipe[build.recipe] then
      entity.recipe = build.recipe
    end
    if with_modules and build.modules and #build.modules > 0 then
      local inv = module_inventory_for(build.machine)
      local items, slot = {}, 0
      for _, m in ipairs(build.modules) do
        if prototypes.item[m] then
          items[#items + 1] = {
            id = { name = m, quality = "normal" },
            items = { in_inventory = { { inventory = inv, stack = slot, count = 1 } } },
          }
          slot = slot + 1
        end
      end
      if #items > 0 then
        entity.items = items
      end
    end
    cursor.set_blueprint_entities({ entity })
  end

  if not pcall(set_entities, true) then
    pcall(set_entities, false)
  end
  -- Temporary cursor stack (the vanilla Ctrl+C mechanism): dropping the cursor
  -- (Q / placing done) DELETES the blueprint instead of stashing it in the
  -- player's inventory — without this every factory click left a blueprint
  -- copy behind.
  if cursor.valid_for_read and cursor.is_blueprint then
    player.cursor_stack_temporary = true
  end
end

-- ── GUI ─────────────────────────────────────────────────────────────────────

local function add_section_label(parent, caption)
  local label = parent.add({ type = "label", caption = caption, style = "caption_label" })
  label.style.top_padding = 6
  return label
end

-- A good's SignalID (item or fluid) for a choose-elem-button, or nil if neither
-- prototype exists in this game (so we can fall back to a plain sprite).
local function good_signal(good)
  if good.kind == "fluid" and prototypes.fluid[good.name] then
    return { type = "fluid", name = good.name }
  elseif prototypes.item[good.name] then
    return { type = "item", name = good.name }
  elseif prototypes.fluid[good.name] then
    return { type = "fluid", name = good.name }
  end
  return nil
end

-- "For 5 min of production, store X" tooltip line: 300 s of throughput, and for
-- solids the stack count too — so the Imports/Exports lists hint at buffer sizing.
local function storage_hint(good)
  local per5 = (good.rate or 0) * 300
  if good.kind ~= "fluid" then
    local item = prototypes.item[good.name]
    if item and item.stack_size and item.stack_size > 0 then
      local stacks = math.ceil(per5 / item.stack_size)
      return { "", "\nFor 5 min: ", fmt_amount(per5), "  (", tostring(stacks), " stacks)" }
    end
  end
  return { "", "\nFor 5 min: ", fmt_amount(per5) }
end

-- One good as an icon cell with a self-formatted /s label tucked under it, so small
-- rates read cleanly instead of the engine's "0.0" (exact rate is in the tooltip).
-- It's a real signal button (locked, so a click can't change it) — that's what lets
-- the engine's own smart-pipette (Q) put the item/fluid on the cursor as a filter
-- signal, exactly like Q-ing a fluid in a pump's filter. Goods that resolve to no
-- item/fluid prototype fall back to a plain sprite. `opts.storage` appends the
-- 5-minute buffer hint (used for the Imports/Exports lists).
local function add_good_cell(parent, good, card_style, opts)
  -- The good sits in its own colored card (blue product / yellow ingredient) so the
  -- icon + rate + logistics read as one separated unit. The card's color carries the
  -- recipe/in/out meaning, so the slot inside is left neutral. A content flow inside
  -- the frame controls the tight inner spacing (frames have no vertical_spacing).
  local card = parent.add({ type = "frame", direction = "vertical", style = card_style or "pyops_card" })
  local cell = card.add({ type = "flow", direction = "vertical" })
  cell.style.vertical_spacing = 0
  cell.style.horizontal_align = "center"
  local tip = { "", good.display or good.name, ":  ", fmt_rate(good.rate), "/s" }
  if good.note == "fuel" then
    tip[#tip + 1] = "  (fuel burned)"
  elseif good.note == "burnt" then
    tip[#tip + 1] = "  (burnt result)"
  end
  if opts and opts.storage then
    tip[#tip + 1] = storage_hint(good)
  end
  local signal = good_signal(good)
  if signal then
    -- A locked signal button so the engine's smart-pipette (Q) still works.
    cell.add({
      type = "choose-elem-button",
      elem_type = "signal",
      signal = signal,
      locked = true,
      style = "slot_button",
      tooltip = { "", tip, "\n[Q] to pipette as a filter signal" },
    })
  else
    cell.add({
      type = "sprite-button",
      sprite = valid_sprite(good.kind, good.name) or "utility/questionmark",
      style = "slot_button",
      tooltip = tip,
    })
  end
  -- Rate overlaid on the slot's lower edge, Helmod-style: a bold label pulled up
  -- over the button with a negative margin. ignored_by_interaction lets the hover/Q
  -- smart-pipette pass straight through to the locked signal button beneath, so we
  -- get the count-on-slot look without giving up Q-pipette.
  local num = cell.add({ type = "label", caption = fmt_num(good.rate) })
  num.ignored_by_interaction = true
  num.style.font = "default-bold"
  num.style.font_color = { 1, 1, 1 }
  num.style.width = 36
  num.style.horizontal_align = "right"
  num.style.top_margin = -19
  num.style.right_padding = 3
  -- Helmod-style logistics line: belts to carry this item (+ inserters/loaders to
  -- feed one building, on recipe rows). Only when the logistics toggle is on and
  -- this good has counts (fluids/electricity carry none).
  local logi = opts and opts.logi
  if logi and good.kind == "item" and (good.belts or good.inserters) then
    -- One label per metric, "[icon] count", stacked by the cell's vertical flow —
    -- the icon labels its own number, and belts vs. movers never collide on a line.
    -- Styled inline (no new prototype) so the control-stage reload loop covers it.
    local mover_word = logi.mover_kind == "loader" and "loaders" or "inserters"
    -- A compact icon+count row per metric: a small explicit-sized sprite (rich-text
    -- [img=] icons render too tall) next to the count, so the readout stays short.
    local add_logi_line = function(path, value, tip)
      if not (path and value and value > 0) then
        return
      end
      local row = cell.add({ type = "flow", direction = "horizontal" })
      row.style.vertical_align = "center"
      row.style.horizontal_spacing = 3
      row.style.top_margin = -2
      local s = row.add({ type = "sprite", sprite = path, resize_to_sprite = false, tooltip = tip })
      s.style.size = 14
      local lbl = row.add({ type = "label", caption = fmt_logi(value), tooltip = tip })
      lbl.style.font = "default-small"
      lbl.style.font_color = { 0.82, 0.85, 0.90 }
    end
    add_logi_line(logi.belt, good.belts, "Belts to carry this item")
    add_logi_line(logi.mover, good.inserters, mover_word:gsub("^%l", string.upper) .. " to feed one building")
  end
  return card
end

-- Order a recipe's goods for display: a pinned primary product first (when given),
-- then solids before fluids, each most → least by rate. Returns a new sorted list.
local function sorted_goods(goods, primary_name)
  local out = {}
  for _, g in ipairs(goods or {}) do
    out[#out + 1] = g
  end
  table.sort(out, function(a, b)
    if primary_name then
      local ap, bp = (a.name == primary_name), (b.name == primary_name)
      if ap ~= bp then
        return ap -- the primary product always leads
      end
    end
    local af, bf = (a.kind == "fluid"), (b.kind == "fluid")
    if af ~= bf then
      return not af -- solids before fluids
    end
    return (a.rate or 0) > (b.rate or 0) -- most → least
  end)
  return out
end

-- A compact grid of good cells (products or ingredients) inside one matrix cell.
-- `cols` widens when the window is maximized so content spreads horizontally.
local function add_goods_grid(parent, goods, slot_style, cols, opts)
  local grid = parent.add({ type = "table", column_count = cols or 3 })
  grid.style.horizontal_spacing = 2
  grid.style.vertical_spacing = 2
  if goods then
    for _, g in ipairs(goods) do
      add_good_cell(grid, g, slot_style, opts)
    end
  end
  return grid
end

-- Imports/Exports as two sorted rows — solids on top, fluids below, each most →
-- least by rate — so ratios and the storage each needs read at a glance. Each row
-- is a single line (column count = its own length, capped) so it fills the width
-- rather than wrapping. Each cell carries the 5-minute buffer hint in its tooltip.
local function add_io_goods(parent, goods, slot_style, logi)
  local solids, fluids = {}, {}
  for _, g in ipairs(goods or {}) do
    if g.kind == "fluid" then
      fluids[#fluids + 1] = g
    else
      solids[#solids + 1] = g
    end
  end
  local by_rate = function(a, b)
    return (a.rate or 0) > (b.rate or 0)
  end
  table.sort(solids, by_rate)
  table.sort(fluids, by_rate)
  local opts = { storage = true, logi = logi }
  if #solids > 0 then
    add_goods_grid(parent, solids, slot_style, math.min(#solids, 12), opts)
  end
  if #fluids > 0 then
    add_goods_grid(parent, fluids, slot_style, math.min(#fluids, 12), opts)
  end
  if #solids == 0 and #fluids == 0 then
    parent.add({ type = "label", caption = "—", style = "pyops_cell_number" })
  end
end

-- The factory cell: the machine icon with its count, clickable for a blueprint,
-- with the module icons (if any) beneath it.
local function add_factory_cell(parent, m)
  local cell = parent.add({ type = "flow", direction = "vertical" })
  cell.style.vertical_spacing = 0
  cell.add({
    type = "sprite-button",
    sprite = valid_sprite("entity", m.machine) or "utility/questionmark",
    style = "slot_button",
    tooltip = {
      "",
      m.recipeDisplay or m.recipe,
      "\n",
      m.machineDisplay or m.machine,
      "  ×",
      tostring(m.count or 1),
      "\nClick for a blueprint (recipe + modules set)\n[Q] to pipette the building",
    },
    tags = {
      pyops_build = { machine = m.machine, recipe = m.recipe, modules = m.modules },
      pyops_pipette = m.machine, -- building name for the Q pipette
    },
    raise_hover_events = true, -- needed for on_gui_hover/leave (Q pipette tracking)
  })
  cell.add({ type = "label", caption = "×" .. fmt_num(m.count or 1), style = "pyops_cell_number" })
  if m.modules and #m.modules > 0 then
    local mods = cell.add({ type = "flow", direction = "horizontal" })
    for _, mod in ipairs(m.modules) do
      local s = valid_sprite("item", mod)
      if s then
        mods.add({ type = "sprite", sprite = s, tooltip = mod })
      end
    end
  end
  return cell
end

-- The beacon cell: each beacon affecting the recipe (icon + count + its modules),
-- or a muted dash when the recipe runs without beacons.
local function add_beacon_cell(parent, beacons)
  local cell = parent.add({ type = "flow", direction = "vertical" })
  cell.style.vertical_spacing = 0
  if not beacons or #beacons == 0 then
    cell.add({ type = "label", caption = "—", style = "pyops_cell_number" })
    return cell
  end
  for _, b in ipairs(beacons) do
    cell.add({
      type = "sprite-button",
      sprite = valid_sprite("entity", b.beacon) or "utility/questionmark",
      style = "slot_button",
      tooltip = { "", b.beacon, "  ×", tostring(b.count or 0), "\n[Q] to pipette" },
      tags = { pyops_pipette = b.beacon }, -- building name for the Q pipette
      raise_hover_events = true, -- needed for on_gui_hover/leave (Q pipette tracking)
    })
    cell.add({ type = "label", caption = "×" .. fmt_num(b.count or 0), style = "pyops_cell_number" })
    if b.modules and #b.modules > 0 then
      local mods = cell.add({ type = "flow", direction = "horizontal" })
      for _, mod in ipairs(b.modules) do
        local s = valid_sprite("item", mod)
        if s then
          mods.add({ type = "sprite", sprite = s, tooltip = mod })
        end
      end
    end
  end
  return cell
end

-- Build (or rebuild) the summary panel. `payload` is stored per player so the
-- maximize toggle can rebuild without it; passing nil reuses the last payload.
-- Close the panel (app cmd.hide_block / dev close tool). Mirrors the titlebar X.
function Summary.hide(player)
  if not (player and player.valid) then
    return
  end
  local panel = player.gui.screen[PANEL_NAME]
  if panel then
    panel.destroy()
  end
end

function Summary.show(player, payload)
  if not (player and player.valid) then
    return
  end
  local state = state_for(player)
  if payload then
    state.payload = payload
  else
    payload = state.payload
  end
  if not payload then
    return
  end
  local maximized = state.maximized
  local minimized = state.minimized
  local show_logistics = state.show_logistics and payload.logistics ~= nil
  -- belt/inserter sprites for the logistics readout, resolved once per build
  local logi = nil
  if show_logistics then
    logi = {
      belt = valid_sprite("entity", payload.logistics.belt),
      mover = payload.logistics.mover and valid_sprite("entity", payload.logistics.mover) or nil,
      mover_kind = payload.logistics.moverKind,
    }
  end
  -- The window sizes to its content (tables grow past the floor when a row needs
  -- it), so the floor stays modest to avoid dead space on the right for small blocks.
  local body_min_width = maximized and 480 or 380

  local existing = player.gui.screen[PANEL_NAME]
  if existing then
    -- Remember where the window sits so a rebuild (toggling logistics, maximize, a
    -- fresh show_block push) keeps the player's chosen position instead of snapping
    -- back to center. The titlebar is a drag_target, so this also persists drags.
    state.location = existing.location
    existing.destroy()
  end

  local panel = player.gui.screen.add({ type = "frame", name = PANEL_NAME, direction = "vertical" })
  -- Anchor by top-left: keep the saved position across rebuilds; only center the
  -- very first time the window is opened (no saved anchor yet).
  if state.location then
    panel.location = state.location
  else
    panel.auto_center = true
  end

  -- Titlebar
  local titlebar = panel.add({ type = "flow", direction = "horizontal" })
  titlebar.drag_target = panel
  titlebar.style.horizontal_spacing = 8
  -- Just the block name — the old "PyOps block:" prefix made the title bar the
  -- widest row, forcing the panel wider than its content (dead space on the right).
  titlebar.add({
    type = "label",
    caption = payload.name or "PyOps block",
    style = "frame_title",
    ignored_by_interaction = true,
  })
  local drag = titlebar.add({ type = "empty-widget", style = "draggable_space_header", ignored_by_interaction = true })
  drag.style.horizontally_stretchable = true
  drag.style.height = 24
  drag.style.right_margin = 4
  -- request-combinator generator — only when the block has imports to request
  if payload.inputs and #payload.inputs > 0 then
    titlebar.add({
      type = "sprite-button",
      name = COMBINATOR_NAME,
      sprite = valid_sprite("entity", "constant-combinator") or "utility/questionmark",
      tooltip = {
        "",
        "Create request combinator",
        "\nArms a selector — drag over the station + holding chests/tanks to size a Cybersyn/LTN request combinator",
      },
      style = "frame_action_button",
    })
  end
  -- logistics: toggle the Helmod-style belt/inserter readout on the good cells
  if payload.logistics and not minimized then
    -- pyops_toggle (not frame_action_button): the action-button style paints a harsh
    -- amber "selected" background over the colored belt icon when toggled; this one
    -- highlights with a subtle blue instead and leaves the icon untouched.
    local logi_btn = titlebar.add({
      type = "sprite-button",
      name = LOGI_NAME,
      sprite = valid_sprite("entity", payload.logistics.belt) or "utility/questionmark",
      tooltip = {
        "",
        show_logistics and "Hide belts & inserters" or "Show belts & inserters",
      },
      style = "pyops_toggle",
    })
    logi_btn.style.size = 24
    logi_btn.toggled = show_logistics
  end
  -- minimize: collapse to just the title bar (park it out of the way mid-build)
  titlebar.add({
    type = "sprite-button",
    name = MIN_NAME,
    sprite = "utility/expand_dots",
    tooltip = { "", minimized and "Restore from title bar" or "Minimize to title bar" },
    style = "frame_action_button",
  })
  -- expand/restore size (only meaningful when the body is shown)
  if not minimized then
    titlebar.add({
      type = "sprite-button",
      name = MAX_NAME,
      sprite = maximized and "utility/collapse" or "utility/expand",
      tooltip = { "", maximized and "Restore size" or "Expand" },
      style = "frame_action_button",
    })
  end
  titlebar.add({
    type = "sprite-button",
    name = CLOSE_NAME,
    sprite = "utility/close",
    tooltip = { "", "Close" },
    style = "frame_action_button",
  })

  -- minimized: title bar only, nothing below it
  if minimized then
    return
  end

  local content = panel.add({ type = "frame", style = "inside_shallow_frame", direction = "vertical" })
  local scroll = content.add({ type = "scroll-pane" })
  scroll.style.maximal_height = maximized and 1200 or 760
  local body = scroll.add({ type = "flow", direction = "vertical" })
  body.style.padding = 12
  body.style.vertical_spacing = 4
  body.style.minimal_width = body_min_width

  -- power / heat
  if payload.powerW and payload.powerW > 0 then
    body.add({ type = "label", caption = { "", "⚡ ", string.format("%.2f", payload.powerW / 1e6), " MW" } })
  end
  if payload.heatW and payload.heatW > 0 then
    body.add({ type = "label", caption = { "", "🔥 ", string.format("%.2f", payload.heatW / 1e6), " MW heat" } })
  end

  -- The production matrix: Products | Factory | Ingredients | (Beacon). The recipe
  -- column was dropped (its icon just mirrors Products); the recipe name lives in
  -- the factory cell's tooltip. The Beacon column is shown only when some recipe
  -- actually has beacons — otherwise it's a column of dashes wasting width. The
  -- custom pyops_matrix_table style zebra-stripes the rows for the Helmod look.
  add_section_label(body, "Recipes — click a factory for a blueprint")
  local has_beacons = false
  for _, m in ipairs(payload.recipes or {}) do
    if m.beacons and #m.beacons > 0 then
      has_beacons = true
      break
    end
  end
  -- Size the product/ingredient grids to the widest recipe so each row stays on one
  -- line and fills the width, instead of wrapping at an arbitrary limit. Each recipe
  -- has its own grid, so a short row reserves no extra width; capped so one giant
  -- recipe can't blow the panel out.
  local function widest(field)
    local n = 1
    for _, m in ipairs(payload.recipes or {}) do
      if m[field] and #m[field] > n then
        n = #m[field]
      end
    end
    return math.min(n, 12)
  end
  local prod_cols = widest("products")
  local ing_cols = widest("ingredients")

  local headers = has_beacons and { "Products", "Factory", "Ingredients", "Beacon" }
    or { "Products", "Factory", "Ingredients" }
  local matrix = body.add({ type = "table", column_count = #headers, style = "pyops_matrix_table" })
  matrix.style.horizontal_spacing = 4 -- tighter columns (closer to Helmod's density)
  for _, h in ipairs(headers) do
    matrix.add({ type = "label", caption = h, style = "bold_label" })
  end
  if payload.recipes then
    for _, m in ipairs(payload.recipes) do
      -- products lead with the recipe's main product (if it has one), then sort;
      -- ingredients just sort solids → fluids, most → least
      local rp = prototypes.recipe[m.recipe]
      local primary = rp and rp.main_product and rp.main_product.name or nil
      add_goods_grid(matrix, sorted_goods(m.products, primary), "pyops_good_product", prod_cols, { logi = logi })
      add_factory_cell(matrix, m)
      add_goods_grid(matrix, sorted_goods(m.ingredients, nil), "pyops_good_ingredient", ing_cols, { logi = logi })
      if has_beacons then
        add_beacon_cell(matrix, m.beacons)
      end
    end
  end

  -- Block boundary: what the whole block draws in / pushes out.
  if (payload.inputs and #payload.inputs > 0) or (payload.outputs and #payload.outputs > 0) then
    add_section_label(body, "Block in / out")
    local io = body.add({ type = "flow", direction = "horizontal" })
    io.style.horizontal_spacing = 24
    -- Exports (products) on the LEFT, Imports (ingredients) on the right — mirrors the
    -- recipe matrix (products left, ingredients right) so products always read left.
    local outcol = io.add({ type = "flow", direction = "vertical" })
    outcol.add({ type = "label", caption = "Exports", style = "bold_label" })
    add_io_goods(outcol, payload.outputs, "pyops_good_product", logi)
    local incol = io.add({ type = "flow", direction = "vertical" })
    incol.add({ type = "label", caption = "Imports", style = "bold_label" })
    add_io_goods(incol, payload.inputs, "pyops_good_ingredient", logi)
  end
end

-- ── Pipette (Q) ──────────────────────────────────────────────────────────────

-- Track the building cell under the cursor (on_gui_hover / on_gui_leave) so the
-- pipette key can act on it. Only the factory/beacon cells carry a pyops_pipette
-- tag (goods are real signal buttons the engine pipettes natively); leaving clears
-- the slot only if it still points at the element being left, so enter/leave
-- arriving in either order can't wipe the wrong target.
function Summary.on_hover(player, element)
  if element.tags and element.tags.pyops_pipette then
    storage.pyops_hover = storage.pyops_hover or {}
    storage.pyops_hover[player.index] = element
  end
end

function Summary.on_leave(player, element)
  local hover = storage.pyops_hover
  if hover and hover[player.index] == element then
    hover[player.index] = nil
  end
end

-- The smart-pipette key was pressed over a building cell: hand its building to the
-- cursor via the engine's own pipette (allow_ghost, so it works even without the
-- item). Goods cells aren't tracked here — the engine pipettes those signal
-- buttons itself.
function Summary.pipette(player)
  local hover = storage.pyops_hover
  local element = hover and hover[player.index]
  if not (element and element.valid) then
    return
  end
  local name = element.tags and element.tags.pyops_pipette
  if type(name) == "string" and prototypes.entity[name] then
    player.pipette_entity(name, true)
  end
end

-- Route a GUI click. Returns true if this module handled it.
function Summary.on_gui_click(player, element)
  if not (element and element.valid) then
    return false
  end

  if element.name == CLOSE_NAME then
    local panel = player.gui.screen[PANEL_NAME]
    if panel then
      panel.destroy()
    end
    return true
  end

  if element.name == MAX_NAME then
    local state = state_for(player)
    state.maximized = not state.maximized
    Summary.show(player) -- rebuild from the stored payload at the new size
    return true
  end

  if element.name == MIN_NAME then
    local state = state_for(player)
    state.minimized = not state.minimized
    Summary.show(player) -- collapse to the title bar (or restore)
    return true
  end

  if element.name == LOGI_NAME then
    local state = state_for(player)
    state.show_logistics = not state.show_logistics
    Summary.show(player) -- rebuild with belt/inserter counts shown or hidden
    return true
  end

  if element.name == COMBINATOR_NAME then
    local state = state_for(player)
    if state.payload then
      Combinator.begin(player, state.payload.inputs)
    end
    return true
  end

  -- factory cells carry their build in tags
  local build = element.tags and element.tags.pyops_build
  if build then
    give_blueprint(player, build)
    return true
  end

  return false
end

return Summary
