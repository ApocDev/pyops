-- In-game Blocks tab: a slot board with one slot per enabled block and one row
-- per block folder. The list arrives from the app as `block.list` (pushed on
-- connect, resync, and whenever it changes); the slot style shows the built
-- state, the slot number the goal rate. Click a slot for its build sheet
-- (`block.show`), shift-click to open the block in the web app (`block.open`).
--
-- Data lives in `storage`:
--   storage.pyops_blocks            — the last `block.list` payload
--   storage.pyops_board[index]      — the player's search text, hide-finished
--                                     toggle, and the block whose sheet is open

local Format = require("format")

local Blocks = {}

local PANEL = "pyops_panel"
local TAB = "pyops_blocks_tab" -- the Blocks-tab content flow (re-found on refresh)
local SEARCH = "pyops_blocks_search"
local HIDE_DONE = "pyops_blocks_hide_done"
local BODY = "pyops_blocks_body"
local SLOT_PREFIX = "pyops_block_slot_"

-- Vanilla slot styles carry the built state: green done, yellow partly built,
-- grey not started.
local STATE_STYLE = {
  done = "green_slot",
  partial = "yellow_slot_button",
  none = "slot_button",
}

local HEALTH_NOTE = {
  warn = "[color=230,190,90]Needs attention in PyOps[/color]",
  error = "[color=220,90,90]Can't be solved as planned[/color]",
}

-- app→mod sender, injected by control.lua to avoid a circular require.
Blocks.send = function(_player, _type, _payload) end

local function view(player)
  storage.pyops_board = storage.pyops_board or {}
  local v = storage.pyops_board[player.index]
  if not v then
    v = { query = "", hide_done = false }
    storage.pyops_board[player.index] = v
  end
  return v
end

local function groups()
  return (storage.pyops_blocks and storage.pyops_blocks.groups) or {}
end

-- Store the list pushed by the app.
function Blocks.set_data(payload)
  storage.pyops_blocks = payload or { groups = {} }
end

-- Number of blocks on the board (the tab caption's count).
function Blocks.count()
  local n = 0
  for _, g in ipairs(groups()) do
    n = n + #(g.blocks or {})
  end
  return n
end

function Blocks.find(id)
  for _, g in ipairs(groups()) do
    for _, b in ipairs(g.blocks or {}) do
      if b.id == id then
        return b
      end
    end
  end
  return nil
end

-- The planner's energy pseudo-goods have no prototype; show the game's own icons.
local PSEUDO_SPRITES = {
  ["pyops-electricity"] = "utility/electricity_icon",
  ["pyops-heat"] = "tooltip-category-heat",
}

local function icon_sprite(icon)
  if not icon then
    return nil
  end
  if PSEUDO_SPRITES[icon.name] then
    return PSEUDO_SPRITES[icon.name]
  end
  for _, path in ipairs({ icon.kind .. "/" .. icon.name, "item/" .. icon.name, "fluid/" .. icon.name }) do
    if helpers.is_valid_sprite_path(path) then
      return path
    end
  end
  return nil
end

-- "[item=lime] 4.61/s", or nil when the block has no goal.
local function goal_text(goal)
  if not goal then
    return nil
  end
  local value, suffix = Format.in_unit(goal.rate, goal.unit)
  local kind = goal.kind == "fluid" and "fluid" or "item"
  local icon = ""
  if PSEUDO_SPRITES[goal.name] then
    icon = "[img=" .. PSEUDO_SPRITES[goal.name] .. "] "
  elseif helpers.is_valid_sprite_path(kind .. "/" .. goal.name) then
    icon = "[" .. kind .. "=" .. goal.name .. "] "
  end
  return icon .. Format.rate(value) .. suffix
end

local function slot_tooltip(b)
  local lines = { "[font=default-bold]" .. (b.name or "?") .. "[/font]" }
  local stats = goal_text(b.goal) or ""
  if (b.powerW or 0) > 0 then
    stats = stats .. "   [img=tooltip-category-electricity] " .. Format.power(b.powerW)
  end
  if stats ~= "" then
    lines[#lines + 1] = stats
  end
  if (b.need or 0) > 0 then
    lines[#lines + 1] = string.format("%d / %d machines built", b.have or 0, b.need)
  else
    lines[#lines + 1] = "No machines to build"
  end
  if HEALTH_NOTE[b.health] then
    lines[#lines + 1] = HEALTH_NOTE[b.health]
  end
  lines[#lines + 1] = "[color=150,155,162]Click: build sheet · Shift+click: open in PyOps[/color]"
  return table.concat(lines, "\n")
end

local function add_slot(parent, b, selected)
  local state = Format.build_state(b.have, b.need)
  local number = nil
  if b.goal then
    number = Format.slot_number((Format.in_unit(b.goal.rate, b.goal.unit)))
  end
  local slot = parent.add({
    type = "sprite-button",
    name = SLOT_PREFIX .. b.id,
    sprite = icon_sprite(b.icon) or "utility/questionmark",
    style = STATE_STYLE[state],
    number = number,
    tooltip = slot_tooltip(b),
  })
  slot.toggled = selected
end

local function build_toolbar(parent, v)
  local bar = parent.add({ type = "frame", style = "subheader_frame" })
  bar.style.horizontally_stretchable = true
  local row = bar.add({ type = "flow", direction = "horizontal" })
  row.style.vertical_align = "center"
  row.style.horizontal_spacing = 6
  row.style.left_padding = 4
  row.style.right_padding = 4
  row.add({ type = "sprite", sprite = "utility/search" })
  local search = row.add({ type = "textfield", name = SEARCH, text = v.query or "", tooltip = "Filter blocks by name" })
  search.style.width = 180
  row.add({ type = "empty-widget" }).style.horizontally_stretchable = true
  local hide = row.add({
    type = "sprite-button",
    name = HIDE_DONE,
    sprite = "utility/check_mark",
    style = "tool_button",
    tooltip = v.hide_done and "Show finished blocks" or "Hide finished blocks",
  })
  hide.toggled = v.hide_done == true
end

-- The board itself: one row per folder, filtered by the search text and the
-- hide-finished toggle. Rebuilt alone while typing so the search box keeps focus.
local function build_board(player, body)
  body.clear()
  local v = view(player)
  -- the panel records the width it got (it shrinks on small screens)
  local panel = player.gui.screen[PANEL]
  local label_width, columns = Format.board_layout(panel and panel.tags.pyops_width or 680)
  if #groups() == 0 then
    local msg = body.add({
      type = "label",
      caption = "No blocks yet. Plan a block in PyOps and it shows up here.",
    })
    msg.style.single_line = false
    return
  end

  body.style.vertical_spacing = 6
  local shown = 0
  for _, g in ipairs(groups()) do
    local visible = {}
    for _, b in ipairs(g.blocks or {}) do
      local done = Format.build_state(b.have, b.need) == "done"
      if Format.matches(b.name, v.query) and not (v.hide_done and done) then
        visible[#visible + 1] = b
      end
    end
    if #visible > 0 then
      shown = shown + #visible
      local row = body.add({ type = "flow", direction = "horizontal" })
      row.style.horizontal_spacing = 12
      local label = row.add({ type = "label", caption = g.name, style = "caption_label" })
      label.style.top_margin = 10
      label.style.width = label_width
      local frame = row.add({ type = "frame", style = "slot_button_deep_frame" })
      local slots = frame.add({ type = "table", column_count = math.min(#visible, columns), style = "filter_slot_table" })
      for _, b in ipairs(visible) do
        add_slot(slots, b, v.selected == b.id)
      end
    end
  end
  if shown == 0 then
    body.add({ type = "label", caption = "No blocks match." })
  end
end

-- Build (or rebuild) the Blocks-tab content into `parent`.
function Blocks.build(player, parent)
  parent.clear()
  parent.style.vertical_spacing = 0
  parent.style.horizontally_stretchable = true
  parent.style.vertically_stretchable = true
  build_toolbar(parent, view(player))

  local scroll = parent.add({ type = "scroll-pane", direction = "vertical" })
  scroll.horizontal_scroll_policy = "never"
  scroll.style.vertically_stretchable = true
  scroll.style.horizontally_stretchable = true
  scroll.style.padding = 8
  build_board(player, scroll.add({ type = "flow", name = BODY, direction = "vertical" }))
end

local function find_child(root, name)
  if not (root and root.valid) then
    return nil
  end
  if root.name == name then
    return root
  end
  for _, c in pairs(root.children) do
    local r = find_child(c, name)
    if r then
      return r
    end
  end
  return nil
end

-- Re-render the Blocks tab in the open panel (after data or view changes).
function Blocks.refresh(player)
  local tab = find_child(player.gui.screen[PANEL], TAB)
  if tab then
    Blocks.build(player, tab)
  end
end

-- The block whose sheet this player has open (from the board), if any.
function Blocks.selected(player)
  return view(player).selected
end

-- Highlight the slot whose build sheet is open (nil when the sheet closes). The
-- sheet calls this, so a sheet opened from the web highlights its slot too.
function Blocks.select(player, id)
  local v = view(player)
  if v.selected ~= id then
    v.selected = id
    Blocks.refresh(player)
  end
end

-- Click dispatch. Returns true if it handled the element.
function Blocks.on_gui_click(player, element, event)
  local name = element.name
  if not name or name == "" then
    return false
  end
  if string.find(name, "^" .. SLOT_PREFIX) then
    local id = tonumber(string.sub(name, #SLOT_PREFIX + 1))
    if not id then
      return true
    end
    if event.shift then
      Blocks.send(player, "block.open", { id = id })
    else
      -- the sheet arrives as cmd.show_block, which also moves the highlight
      Blocks.send(player, "block.show", { id = id })
    end
    return true
  elseif name == HIDE_DONE then
    local v = view(player)
    v.hide_done = not v.hide_done
    Blocks.refresh(player)
    return true
  end
  return false
end

-- Search box typing: re-filter the board without touching the search box.
-- Returns true if it handled the element.
function Blocks.on_text_changed(player, element)
  if element.name ~= SEARCH then
    return false
  end
  view(player).query = element.text
  local body = find_child(player.gui.screen[PANEL], BODY)
  if body then
    build_board(player, body)
  end
  return true
end

return Blocks
