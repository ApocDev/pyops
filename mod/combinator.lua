-- PyOps request-combinator planner. Turns a block's imports (pushed from the web
-- via cmd.show_block) into a plain `constant-combinator` you can wire to a Cybersyn
-- / LTN station: signal-A = network mask, plus one negative request signal per
-- import. Deliberately mod-agnostic — no Cybersyn-specific tags — so the same
-- combinator drives any train-logistics mod that reads request signals.
--
-- Flow: the summary panel's "Create request combinator" button arms a selection
-- tool; you drag it over the station + its holding chests/tanks; the mod measures
-- the REAL storage, opens a dialog (the one knob that matters is the time window),
-- and on confirm drops the finished blueprint on your cursor. No web round-trip,
-- no copy-paste — sizing is just rate × window, capped by what the storage holds.

local Combinator = {}

local TOOL_NAME = "pyops-combinator-planner"
local DIALOG_NAME = "pyops_combinator_dialog"
local WINDOW_FIELD = "pyops_comb_window"
local NETWORK_FIELD = "pyops_comb_network"
local MASK_FIELD = "pyops_comb_mask"
local CREATE_NAME = "pyops_comb_create"
local CLOSE_NAME = "pyops_comb_close"
local GROUP_PREFIX = "pyops_comb_grp__" -- + prototype name; one checkbox per storage group
local TOTAL_LABEL = "pyops_comb_total"
local DEBUG_NAME = "pyops_debug_window"
local DEBUG_CLOSE = "pyops_debug_close"
local DEBUG_TEXT = "pyops_debug_text"

Combinator.TOOL_NAME = TOOL_NAME

local DEFAULT_WINDOW = 300

-- Energy pseudo-fluids the planner models; never real train cargo, skip them.
-- (The web already filters these out of `inputs`, but guard anyway.)
local EXCLUDED = { ["pyops-electricity"] = true, ["pyops-heat"] = true }

-- Chest-like prototypes whose slots count toward the shared item buffer.
-- (infinity-container is deliberately absent — EE test sinks aren't real buffer.)
local CHEST_TYPES = {
  container = true,
  ["logistic-container"] = true,
}

local function state_for(player)
  storage.pyops_combinator = storage.pyops_combinator or {}
  local s = storage.pyops_combinator[player.index]
  if not s then
    s = { window = DEFAULT_WINDOW, network = "A", mask = 1 }
    storage.pyops_combinator[player.index] = s
  end
  return s
end

-- GUI elements can't be cached across events; find one by name in a subtree.
local function find_descendant(root, name)
  if not (root and root.valid) then
    return nil
  end
  if root.name == name then
    return root
  end
  for _, child in pairs(root.children) do
    local found = find_descendant(child, name)
    if found then
      return found
    end
  end
  return nil
end

-- Always-available copyable debug panel: a selectable text-box (chat lines can't be
-- copied). Toggle with CTRL+SHIFT+D; click inside, Ctrl+A, Ctrl+C. Diagnostics are
-- only written while it's open (see `debug`), so it's silent unless you ask for it.
local function build_debug_window(player)
  local frame = player.gui.screen.add({ type = "frame", name = DEBUG_NAME, direction = "vertical" })
  frame.auto_center = true
  local title = frame.add({ type = "flow", direction = "horizontal" })
  title.drag_target = frame
  title.add({
    type = "label",
    caption = "PyOps debug — click inside, Ctrl+A, Ctrl+C",
    style = "frame_title",
    ignored_by_interaction = true,
  })
  local drag = title.add({ type = "empty-widget", style = "draggable_space_header", ignored_by_interaction = true })
  drag.style.horizontally_stretchable = true
  drag.style.height = 24
  title.add({
    type = "sprite-button",
    name = DEBUG_CLOSE,
    sprite = "utility/close",
    style = "frame_action_button",
  })
  local tb = frame.add({ type = "text-box", name = DEBUG_TEXT, text = "" })
  tb.read_only = true
  tb.style.width = 520
  tb.style.height = 320
  return frame
end

-- Toggle the debug panel open/closed (CTRL+SHIFT+D).
function Combinator.toggle_debug(player)
  local w = player.gui.screen[DEBUG_NAME]
  if w then
    w.destroy()
  else
    build_debug_window(player)
  end
end

-- Write text to the debug panel, but only if it's open — diagnostics elsewhere call
-- this freely; nothing shows unless the player has toggled the panel on.
local function debug(player, text)
  local w = player.gui.screen[DEBUG_NAME]
  if not w then
    return
  end
  local tb = find_descendant(w, DEBUG_TEXT)
  if tb then
    tb.text = text
  end
end

-- Accumulate one entity into a storage group (keyed string `key`, displayed as
-- `label`), so the dialog can show "Steel warehouse ×1 — 1500 slots" or
-- "Hydrogen ×2 — 60000 fluid" and let the player exclude whole groups. `fluid`
-- (optional) ties a fluid group back to its signal name for per-fluid capping.
local function group_add(groups, key, label, amount, fluid)
  local g = groups[key]
  if not g then
    g = { key = key, label = label, count = 0, amount = 0, fluid = fluid }
    groups[key] = g
  end
  g.count = g.count + 1
  g.amount = g.amount + amount
  return g
end

-- Flatten the keyed groups into a list sorted by contribution (biggest first).
local function sorted_groups(groups)
  local arr = {}
  for _, g in pairs(groups) do
    arr[#arr + 1] = g
  end
  table.sort(arr, function(a, b)
    return a.amount > b.amount
  end)
  return arr
end

-- From only the checked groups: total item slots (one shared pool) and a per-fluid
-- capacity map (fluids are stored separately, so each is capped on its own tanks).
local function measured_totals(s)
  local slots = 0
  local fluid_caps = {}
  local excluded = s.excluded or {}
  for _, g in ipairs(s.item_groups or {}) do
    if not excluded[g.key] then
      slots = slots + g.amount
    end
  end
  for _, g in ipairs(s.fluid_groups or {}) do
    if not excluded[g.key] and g.fluid then
      fluid_caps[g.fluid] = (fluid_caps[g.fluid] or 0) + g.amount
    end
  end
  return slots, fluid_caps
end

local function totals_caption(slots, fluid_caps)
  local total_fluid = 0
  for _, cap in pairs(fluid_caps or {}) do
    total_fluid = total_fluid + cap
  end
  return { "", "Using ", tostring(slots), " slots · ", string.format("%.0f", total_fluid), " fluid" }
end

-- Step 1: arm the selection tool with this block's imports stashed for the player.
function Combinator.begin(player, imports)
  if not (player and player.valid) then
    return
  end
  local cargo = {}
  for _, g in ipairs(imports or {}) do
    if g.name and not EXCLUDED[g.name] and (g.rate or 0) > 0 then
      cargo[#cargo + 1] = { name = g.name, kind = g.kind or "item", rate = g.rate }
    end
  end
  if #cargo == 0 then
    player.print({ "", "PyOps: this block has no imports to request." })
    return
  end

  state_for(player).imports = cargo

  local cursor = player.cursor_stack
  if not cursor then
    return
  end
  cursor.set_stack({ name = TOOL_NAME })
  player.print({
    "",
    "PyOps: drag over the station and its holding chests/tanks to size the request combinator.",
  })
end

-- Step 2: the player dragged the tool over their station + storage. Measure the
-- real capacity (chest slots for items, tank capacity for fluids) and open the
-- dialog so they can pick the time window and confirm.
function Combinator.on_selected(player, entities)
  local s = state_for(player)
  if not s.imports then
    return
  end

  -- Pass 1: link each pump's tag (a real fluid, or a `parameter-N` from a
  -- parametrised blueprint) to its tank chain. A parameter pump has NO segment of
  -- its own, so we read the segment from the neighbour across each pipe connection
  -- (the tank/pipe on the far side) — that's the segment the tank chain shares.
  local seg_tag = {}
  for _, e in pairs(entities) do
    if e.valid and e.type == "pump" then
      local fb = e.fluidbox
      local tag
      for i = 1, #fb do
        local filter = fb.get_filter(i)
        if filter then
          tag = filter.name
          break
        end
      end
      if tag then
        for i = 1, #fb do
          local ok, conns = pcall(fb.get_pipe_connections, i)
          if ok and conns then
            for _, c in pairs(conns) do
              local nb = c.target and c.target.owner
              if nb and nb.valid then
                local nfb = nb.fluidbox
                for j = 1, #nfb do
                  local seg = nfb.get_fluid_segment_id(j)
                  if seg then
                    seg_tag[seg] = tag
                  end
                end
              end
            end
          end
        end
      end
    end
  end

  -- Pass 2: group real tanks by the tag of the chain they sit in (per-chain
  -- capacity, any length). Loader pipes / internal helpers (hidden, non-selectable)
  -- are skipped. Items pool by chest prototype.
  local item_groups, tag_groups, stop_name = {}, {}, nil
  for _, e in pairs(entities) do
    if e.valid then
      local t = e.type
      if CHEST_TYPES[t] then
        local inv = e.get_inventory(defines.inventory.chest)
        if inv and #inv > 0 then
          group_add(item_groups, "i_" .. e.name, e.localised_name, #inv)
        end
      elseif t == "storage-tank" and e.prototype.selectable_in_game and not e.prototype.hidden then
        local cap = e.prototype.fluid_capacity or 0
        if cap > 0 then
          local fb = e.fluidbox
          local tag
          for i = 1, #fb do
            local seg = fb.get_fluid_segment_id(i)
            if seg and seg_tag[seg] then
              tag = seg_tag[seg]
              break
            end
          end
          if tag then
            local g = group_add(tag_groups, "t_" .. tag, tag, cap, tag)
            g.tag = tag
          end
        end
      elseif t == "train-stop" then
        stop_name = e.backer_name or stop_name
      end
    end
  end

  s.item_groups = sorted_groups(item_groups)
  s.fluid_groups = sorted_groups(tag_groups)
  s.excluded = {}
  s.stop_name = stop_name

  -- The block's fluid imports are the assignment targets for the dialog dropdowns.
  local fluid_imports, fluid_rate = {}, {}
  for _, g in ipairs(s.imports) do
    if g.kind == "fluid" then
      fluid_imports[#fluid_imports + 1] = g.name
      fluid_rate[g.name] = g.rate or 0
    end
  end
  s.fluid_imports = fluid_imports

  -- Resolve each chain's tag → a real fluid. A real-fluid tag (concrete station)
  -- maps to itself; parameter tags auto-map by SIZE: biggest tank chain → highest-
  -- demand fluid. It's the best first guess; the dialog dropdowns let the player
  -- correct any mismatch.
  -- NB: parameter signals (parameter-0..N) are registered as fluid prototypes too
  -- (so they can fill a fluid filter slot), so prototypes.fluid[tag] can't tell a
  -- real fluid from a parameter — match the name pattern explicitly.
  local used = {}
  local params = {}
  for _, g in ipairs(s.fluid_groups) do
    if not g.tag:match("^parameter%-%d+$") and prototypes.fluid[g.tag] then
      g.fluid = g.tag
      g.label = prototypes.fluid[g.tag].localised_name
      used[g.tag] = true
    else
      local vs = prototypes.virtual_signal[g.tag]
      g.label = vs and vs.localised_name or g.tag
      params[#params + 1] = g
    end
  end
  table.sort(params, function(a, b)
    return a.amount > b.amount
  end)
  local unused = {}
  for _, name in ipairs(fluid_imports) do
    if not used[name] then
      unused[#unused + 1] = name
    end
  end
  table.sort(unused, function(a, b)
    return (fluid_rate[a] or 0) > (fluid_rate[b] or 0)
  end)
  for i, g in ipairs(params) do
    g.fluid = unused[i]
  end

  -- Put the tool away so the player isn't left holding it.
  local cursor = player.cursor_stack
  if cursor and cursor.valid_for_read and cursor.name == TOOL_NAME then
    cursor.clear()
  end

  Combinator.open_dialog(player)
end

local function add_field(parent, label, name, text, numeric)
  parent.add({ type = "label", caption = label })
  local field = parent.add({
    type = "textfield",
    name = name,
    text = text,
    numeric = numeric or false,
    allow_decimal = false,
    allow_negative = false,
  })
  field.style.width = 90
  return field
end

function Combinator.open_dialog(player)
  local s = state_for(player)
  local screen = player.gui.screen
  if screen[DIALOG_NAME] then
    screen[DIALOG_NAME].destroy()
  end

  local frame = screen.add({ type = "frame", name = DIALOG_NAME, direction = "vertical" })
  frame.auto_center = true

  local titlebar = frame.add({ type = "flow", direction = "horizontal" })
  titlebar.drag_target = frame
  titlebar.style.horizontal_spacing = 8
  titlebar.add({
    type = "label",
    caption = "PyOps request combinator",
    style = "frame_title",
    ignored_by_interaction = true,
  })
  local drag = titlebar.add({
    type = "empty-widget",
    style = "draggable_space_header",
    ignored_by_interaction = true,
  })
  drag.style.horizontally_stretchable = true
  drag.style.height = 24
  titlebar.add({
    type = "sprite-button",
    name = CLOSE_NAME,
    sprite = "utility/close",
    style = "frame_action_button",
    tooltip = { "", "Close" },
  })

  -- Content lives in an inner flow: spacing styles (vertical_spacing) aren't valid
  -- on a frame, only on flows/tables.
  local content = frame.add({ type = "frame", style = "inside_shallow_frame", direction = "vertical" })
  local body = content.add({ type = "flow", direction = "vertical" })
  body.style.padding = 12
  body.style.vertical_spacing = 8
  body.style.minimal_width = 340

  -- Item buffer: chest groups, each with a checkbox to drop storage that isn't the
  -- request buffer (provider trim chest, merging chests, …) — the engine has no
  -- notion of "belongs to this stop", so the call is the player's.
  body.add({ type = "label", caption = "Item buffer — uncheck what isn't the buffer", style = "bold_label" })
  for _, g in ipairs(s.item_groups or {}) do
    local row = body.add({ type = "flow", direction = "horizontal" })
    row.style.horizontally_stretchable = true
    row.style.vertical_align = "center"
    row.style.horizontal_spacing = 8
    local cb = row.add({
      type = "checkbox",
      name = GROUP_PREFIX .. g.key,
      state = not (s.excluded and s.excluded[g.key]),
      caption = { "", g.label, g.count > 1 and (" ×" .. g.count) or "" },
      tags = { pyops_group = g.key },
    })
    cb.style.horizontally_stretchable = true
    row.add({ type = "label", caption = string.format("%.0f slots", g.amount) })
  end
  if #(s.item_groups or {}) == 0 then
    body.add({ type = "label", caption = "(no item chests selected)" })
  end

  -- Fluid chains: one row per tank chain (capacity follows the piping). Assign each
  -- to one of the block's fluid imports — parameter chains can't name their own
  -- fluid, so this dropdown is the binding. Default is the by-index guess.
  if #(s.fluid_groups or {}) > 0 then
    body.add({ type = "label", caption = "Fluid chains — assign each to a fluid", style = "bold_label" })
    local items = { "(skip)" }
    for _, name in ipairs(s.fluid_imports or {}) do
      local p = prototypes.fluid[name]
      items[#items + 1] = p and p.localised_name or name
    end
    for _, g in ipairs(s.fluid_groups) do
      local row = body.add({ type = "flow", direction = "horizontal" })
      row.style.horizontally_stretchable = true
      row.style.vertical_align = "center"
      row.style.horizontal_spacing = 8
      row.add({ type = "label", caption = { "", g.label, g.count > 1 and (" ×" .. g.count) or "" } })
      row.add({ type = "label", caption = string.format("%.0f", g.amount) })
      local spacer = row.add({ type = "empty-widget" })
      spacer.style.horizontally_stretchable = true
      local sel = 1
      for k, name in ipairs(s.fluid_imports or {}) do
        if g.fluid == name then
          sel = k + 1
          break
        end
      end
      local dd = row.add({
        type = "drop-down",
        items = items,
        selected_index = sel,
        tags = { pyops_param_tag = g.tag },
      })
      dd.style.minimal_width = 150
    end
    if #(s.fluid_imports or {}) == 0 then
      local hint = body.add({ type = "label", caption = "(this block imports no fluids to assign)" })
      hint.style.font_color = { r = 1, g = 0.7, b = 0.2 }
    end
  end

  local slots, cap = measured_totals(s)
  body.add({ type = "label", name = TOTAL_LABEL, caption = totals_caption(slots, cap), style = "bold_label" })

  -- Knobs. The time window is the one that matters day-to-day.
  body.add({ type = "label", caption = "Settings", style = "bold_label" })
  local knobs = body.add({ type = "table", column_count = 2 })
  knobs.style.horizontal_spacing = 16
  knobs.style.vertical_spacing = 6
  add_field(knobs, "Time window (s)", WINDOW_FIELD, tostring(s.window or DEFAULT_WINDOW), true)
  add_field(knobs, "Network signal", NETWORK_FIELD, s.network or "A", false)
  add_field(knobs, "Network mask", MASK_FIELD, tostring(s.mask or 1), true)

  local buttons = body.add({ type = "flow", direction = "horizontal" })
  buttons.style.top_padding = 8
  buttons.style.horizontal_spacing = 8
  buttons.add({ type = "button", name = CLOSE_NAME, caption = "Cancel" })
  local spacer = buttons.add({ type = "empty-widget" })
  spacer.style.horizontally_stretchable = true
  buttons.add({
    type = "button",
    name = CREATE_NAME,
    caption = "Create combinator",
    style = "confirm_button",
  })
end

-- Map a network letter ("A".."Z") to its virtual signal; pass anything else
-- through as a full signal name.
local function network_signal(network)
  local n = network and network:match("^%s*(.-)%s*$") or ""
  if n:match("^%a$") then
    return "signal-" .. n:upper()
  end
  return n ~= "" and n or "signal-A"
end

-- Turn the stashed imports + measured storage + window into a constant-combinator
-- blueprint and drop it on the cursor. Items: need = rate × window → slots; the
-- shared chest caps the SUM of slots, scaling every item down proportionally.
-- Fluids: each capped at its OWN tanks' capacity (per-fluid map from the segment
-- grouping). Signs follow the request convention: negative = request.
local function build_combinator(player)
  local s = state_for(player)
  local window = s.window or DEFAULT_WINDOW
  local chest_slots, fluid_caps = measured_totals(s)

  local items, fluids = {}, {}
  for _, g in ipairs(s.imports or {}) do
    if g.kind == "fluid" then
      fluids[#fluids + 1] = g
    else
      items[#items + 1] = g
    end
  end

  -- Item slot demand → scale factor if it overflows the shared chest.
  local raw_slots = 0
  for _, it in ipairs(items) do
    local proto = prototypes.item[it.name]
    it._stack = (proto and proto.stack_size) or 1
    it._need = it.rate * window
    raw_slots = raw_slots + math.ceil(it._need / it._stack)
  end
  local factor = 1
  if chest_slots > 0 and raw_slots > chest_slots then
    factor = chest_slots / raw_slots
  end

  local filters, idx = {}, 0
  for _, it in ipairs(items) do
    if prototypes.item[it.name] then
      idx = idx + 1
      local count = math.max(1, math.floor(it._need * factor + 0.5))
      filters[#filters + 1] = {
        index = idx,
        name = it.name,
        type = "item",
        quality = "normal",
        comparator = "=",
        count = -count,
      }
    end
  end
  for _, fl in ipairs(fluids) do
    if prototypes.fluid[fl.name] then
      idx = idx + 1
      local need = fl.rate * window
      local cap = fluid_caps[fl.name]
      if cap and cap > 0 and need > cap then
        need = cap
      end
      filters[#filters + 1] = {
        index = idx,
        name = fl.name,
        type = "fluid",
        quality = "normal",
        comparator = "=",
        count = -math.max(1, math.floor(need + 0.5)),
      }
    end
  end

  -- Network membership in its own section: the virtual signal at the chosen mask.
  -- quality="normal" is required on every filter (even fluids/virtuals) in 2.0's
  -- unified-signal blueprint format — without it the count imports as 0.
  local net = network_signal(s.network or "A")
  local mask = math.max(1, math.floor(s.mask or 1))
  local sections = {}
  if #filters > 0 then
    sections[#sections + 1] = { index = 1, filters = filters }
  end
  sections[#sections + 1] = {
    index = #sections + 1,
    filters = {
      { index = 1, name = net, type = "virtual", quality = "normal", comparator = "=", count = mask },
    },
  }

  local cursor = player.cursor_stack
  if not cursor then
    return false
  end

  -- Deliver via a real blueprint string (same serialization a manual paste uses),
  -- not set_blueprint_entities — the native filter table shape differs from the
  -- blueprint JSON, and this JSON shape is the one already proven in the web app.
  local label = "Request: " .. (s.stop_name or "block")
  local first = filters[1]
  local blueprint = {
    blueprint = {
      item = "blueprint",
      label = label,
      icons = first and { { signal = { type = first.type, name = first.name }, index = 1 } } or nil,
      entities = {
        {
          entity_number = 1,
          name = "constant-combinator",
          position = { x = 0.5, y = 0.5 },
          control_behavior = { sections = { sections = sections } },
        },
      },
      version = 562949957812224,
    },
  }
  local bp_string = "0" .. helpers.encode_string(helpers.table_to_json(blueprint))
  cursor.set_stack({ name = "blueprint" })
  if cursor.import_stack(bp_string) < 0 then
    player.print({ "", "PyOps: failed to build the combinator blueprint." })
    return false
  end
  cursor.label = label
  return true
end

-- A storage-group checkbox toggled: update the exclusion set and refresh the
-- running total so the player sees the cap they'll actually get. Returns true if
-- this module handled it.
function Combinator.on_gui_checked(player, element)
  if not (element and element.valid and element.tags) then
    return false
  end
  local key = element.tags.pyops_group
  if not key then
    return false
  end
  local s = state_for(player)
  s.excluded = s.excluded or {}
  s.excluded[key] = (not element.state) or nil

  local dialog = player.gui.screen[DIALOG_NAME]
  local total = dialog and find_descendant(dialog, TOTAL_LABEL)
  if total then
    local slots, cap = measured_totals(s)
    total.caption = totals_caption(slots, cap)
  end
  return true
end

-- A fluid-chain dropdown changed: bind that chain to the chosen fluid import (or
-- nil for "(skip)") and refresh the total. Returns true if this module handled it.
function Combinator.on_gui_selection(player, element)
  if not (element and element.valid and element.tags) then
    return false
  end
  local tag = element.tags.pyops_param_tag
  if not tag then
    return false
  end
  local s = state_for(player)
  local idx = element.selected_index or 1
  local fluid = idx > 1 and (s.fluid_imports or {})[idx - 1] or nil
  for _, g in ipairs(s.fluid_groups or {}) do
    if g.tag == tag then
      g.fluid = fluid
      break
    end
  end

  local dialog = player.gui.screen[DIALOG_NAME]
  local total = dialog and find_descendant(dialog, TOTAL_LABEL)
  if total then
    local slots, cap = measured_totals(s)
    total.caption = totals_caption(slots, cap)
  end
  return true
end

-- Route a GUI click. Returns true if this module handled it.
function Combinator.on_gui_click(player, element)
  if not (element and element.valid) then
    return false
  end
  local name = element.name

  if name == CLOSE_NAME then
    local dialog = player.gui.screen[DIALOG_NAME]
    if dialog then
      dialog.destroy()
    end
    return true
  end

  if name == DEBUG_CLOSE then
    local win = player.gui.screen[DEBUG_NAME]
    if win then
      win.destroy()
    end
    return true
  end

  if name == CREATE_NAME then
    local s = state_for(player)
    local dialog = player.gui.screen[DIALOG_NAME]
    if dialog then
      local wf = find_descendant(dialog, WINDOW_FIELD)
      local nf = find_descendant(dialog, NETWORK_FIELD)
      local mf = find_descendant(dialog, MASK_FIELD)
      s.window = math.max(1, math.floor(tonumber(wf and wf.text) or DEFAULT_WINDOW))
      s.network = (nf and nf.text ~= "" and nf.text) or "A"
      s.mask = math.max(1, math.floor(tonumber(mf and mf.text) or 1))
    end
    if build_combinator(player) then
      if dialog then
        dialog.destroy()
      end
      player.print({
        "",
        "PyOps: request combinator on your cursor — place it and wire it to the station.",
      })
    end
    return true
  end

  return false
end

return Combinator
