-- In-game task panel. Renders the project's tasks — pushed from the
-- app over the bridge (task.list) — as a collapsible master-detail list, and owns
-- the New-task capture dialog (task.capture). Read-only for now: status/step writes
-- land in a later pass. Vanilla styles throughout; status and priority read as
-- colored text in the web app's colors.
--
-- Data lives in `storage`:
--   storage.pyops_tasks            — the list pushed by the app
--   storage.pyops_task_sel[index]  — the player's selected task id

local Tasks = {}

local PANEL = "pyops_panel"
local TAB = "pyops_tasks_tab" -- the Tasks-tab content flow (re-found on refresh)
local DIALOG = "pyops_newtask"

-- app→mod sender, injected by control.lua to avoid a circular require.
Tasks.send = function(_player, _type, _payload) end

-- Status colors mirror the web (open=gray, in_progress=amber, done=emerald,
-- closed=slate). Rendered as colored bullets, never the engine's dark icons.
local STATUS_DOT = {
  open = "150,155,162",
  in_progress = "251,191,36", -- amber-400
  done = "16,185,129", -- emerald-500
  closed = "100,116,139", -- slate-500
}
local STATUS_TEXT = {
  open = "OPEN",
  in_progress = "IN PROGRESS",
  done = "DONE",
  closed = "CLOSED",
}
local DONE_DOT, OPEN_DOT = "16,185,129", "150,155,162" -- step glyphs (done / not-done)
local MUTED = "150,155,162"
local PRIO_BADGE = {
  low = { "150,160,175", "LOW" },
  medium = { "230,190,90", "MED" },
  high = { "220,90,90", "HIGH" },
  critical = { "200,150,240", "CRIT" },
}

-- "[color=r,g,b]text[/color]"
local function tinted(color, text)
  return "[color=" .. color .. "]" .. text .. "[/color]"
end

local function tasks_list()
  storage.pyops_tasks = storage.pyops_tasks or {}
  return storage.pyops_tasks
end

local function selected_id(player)
  storage.pyops_task_sel = storage.pyops_task_sel or {}
  return storage.pyops_task_sel[player.index]
end

local function set_selected(player, id)
  storage.pyops_task_sel = storage.pyops_task_sel or {}
  storage.pyops_task_sel[player.index] = id
end

local function find_task(id)
  for _, t in ipairs(tasks_list()) do
    if t.id == id then
      return t
    end
  end
  return nil
end

-- Recursive find-by-name (the tab content is nested inside the tabbed-pane).
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

local function valid_sprite(path)
  return path and helpers.is_valid_sprite_path(path) and path or nil
end

-- Store the tasks pushed by the app.
function Tasks.set_data(list)
  storage.pyops_tasks = list or {}
end

-- Open + in-progress tasks (the tab caption's count).
function Tasks.open_count()
  local n = 0
  for _, t in ipairs(tasks_list()) do
    if t.status == "open" or t.status == "in_progress" then
      n = n + 1
    end
  end
  return n
end

-- ── List row (clickable; rich-text caption keeps it a single button) ──────────
local function row_caption(task)
  local dot = STATUS_DOT[task.status] or STATUS_DOT.open
  local cap = "[color=" .. dot .. "]●[/color] " .. (task.title or "(untitled)")
  local pb = PRIO_BADGE[task.priority]
  if pb then
    cap = cap .. "  " .. tinted(pb[1], pb[2])
  end
  for _, l in ipairs(task.links or {}) do
    if l.kind == "location" then
      cap = cap .. " [img=utility/map]"
    elseif valid_sprite(l.sprite) then
      cap = cap .. " [img=" .. l.sprite .. "]"
    end
  end
  return cap
end

local function build_list(player, parent, current)
  local lf = parent.add({ type = "frame", style = "inside_deep_frame", direction = "vertical" })
  lf.style.vertically_stretchable = true
  local sp = lf.add({ type = "scroll-pane" })
  sp.horizontal_scroll_policy = "never"
  sp.style.width = 280
  sp.style.vertically_stretchable = true
  sp.style.padding = 4
  local list = tasks_list()
  if #list == 0 then
    local m = sp.add({ type = "label", style = "grey_label", caption = "No tasks yet. Click New task to add one." })
    m.style.single_line = false
    m.style.padding = 6
    return
  end
  for _, t in ipairs(list) do
    local row = sp.add({
      type = "button",
      name = "pyops_task_row_" .. t.id,
      style = "list_box_item",
      caption = row_caption(t),
    })
    row.style.horizontally_stretchable = true
    if current and t.id == current.id then
      row.toggled = true
    end
  end
end

local function build_detail(parent, task)
  local df = parent.add({ type = "frame", style = "inside_shallow_frame", direction = "vertical" })
  df.style.minimal_width = 300
  df.style.horizontally_stretchable = true
  df.style.vertically_stretchable = true
  local dfb = df.add({ type = "flow", direction = "vertical" })
  dfb.style.padding = 10
  dfb.style.vertical_spacing = 8
  dfb.style.horizontally_stretchable = true

  if not task then
    dfb.add({ type = "label", style = "grey_label", caption = "Select a task." })
    return
  end

  -- Title, then a status + priority line in the web app's colors
  local title = dfb.add({ type = "label", style = "heading_2_label", caption = task.title or "(untitled)" })
  title.style.single_line = false
  local meta = {}
  if STATUS_TEXT[task.status] then
    meta[#meta + 1] = tinted(STATUS_DOT[task.status], "● " .. STATUS_TEXT[task.status])
  end
  local pb = PRIO_BADGE[task.priority]
  if pb then
    meta[#meta + 1] = tinted(pb[1], pb[2])
  end
  if #meta > 0 then
    dfb.add({ type = "label", style = "semibold_label", caption = table.concat(meta, "    ") })
  end

  -- Body (plain wrapped text; markdown stays in the web UI)
  if task.body and task.body ~= "" then
    local body = dfb.add({ type = "label", caption = task.body })
    body.style.single_line = false
    body.style.horizontally_stretchable = true
    body.style.font_color = { 0.82, 0.84, 0.88 }
  else
    dfb.add({ type = "label", style = "grey_label", caption = "No description." })
  end

  -- Steps (read-only check/dot glyphs for now)
  if task.steps and #task.steps > 0 then
    dfb.add({ type = "line" })
    dfb.add({ type = "label", style = "caption_label", caption = "Steps" })
    for _, s in ipairs(task.steps) do
      local dot = s.done and DONE_DOT or OPEN_DOT
      local txt = s.done and tinted(MUTED, s.text) or s.text
      local step = dfb.add({ type = "label", caption = tinted(dot, "●") .. "  " .. txt })
      step.style.single_line = false
    end
  end

  -- Links (icon slots + a Go-to button for the location anchor)
  if task.links and #task.links > 0 then
    dfb.add({ type = "line" })
    dfb.add({ type = "label", style = "caption_label", caption = "Links" })
    local lk = dfb.add({ type = "flow", direction = "horizontal" })
    lk.style.horizontal_spacing = 4
    lk.style.vertical_align = "center"
    local goto_link = nil
    for _, l in ipairs(task.links) do
      if l.kind == "location" then
        goto_link = l
      else
        local sp = valid_sprite(l.sprite)
        if sp then
          local b = lk.add({ type = "sprite-button", sprite = sp, style = "slot_button", tooltip = l.display })
          b.style.size = 36
        end
      end
    end
    if goto_link then
      lk.add({ type = "empty-widget" }).style.horizontally_stretchable = true
      local gb = lk.add({
        type = "button",
        name = "pyops_task_goto",
        style = "tool_button",
        caption = "[img=utility/map] Go to "
          .. (goto_link.surface or "?")
          .. " ("
          .. math.floor(goto_link.x or 0)
          .. ", "
          .. math.floor(goto_link.y or 0)
          .. ")",
      })
      gb.tags = { x = goto_link.x, y = goto_link.y }
    end
  end
end

-- Build (or rebuild) the Tasks-tab content into `parent`.
function Tasks.build(player, parent)
  parent.clear()
  parent.style.padding = 4
  parent.style.vertical_spacing = 6
  parent.style.horizontally_stretchable = true
  parent.style.vertically_stretchable = true

  -- resolve selection (default to the first task)
  local current = find_task(selected_id(player))
  if not current and #tasks_list() > 0 then
    current = tasks_list()[1]
    set_selected(player, current.id)
  end

  -- toolbar
  local barf = parent.add({ type = "frame", style = "subheader_frame" })
  barf.style.horizontally_stretchable = true
  local bar = barf.add({ type = "flow", direction = "horizontal" })
  bar.style.vertical_align = "center"
  bar.style.horizontal_spacing = 6
  bar.style.left_padding = 4
  bar.style.right_padding = 4
  bar.style.top_padding = 2
  bar.style.bottom_padding = 2
  bar.add({
    type = "button",
    name = "pyops_task_new",
    caption = "[img=utility/add] New task",
    style = "confirm_button", -- green, like Factorio's submit button
  })
  bar.add({
    type = "sprite-button",
    name = "pyops_task_refresh",
    sprite = "utility/refresh",
    style = "tool_button",
    tooltip = "Refresh",
  })

  -- master-detail
  local md = parent.add({ type = "flow", direction = "horizontal" })
  md.style.horizontal_spacing = 6
  md.style.horizontally_stretchable = true
  md.style.vertically_stretchable = true
  build_list(player, md, current)
  build_detail(md, current)
end

-- Re-render the Tasks tab in the open panel (after data or selection changes).
function Tasks.refresh(player)
  local panel = player.gui.screen[PANEL]
  if not (panel and panel.valid) then
    return
  end
  local tab = find_child(panel, TAB)
  if tab then
    Tasks.build(player, tab)
  end
end

-- ── New-task dialog ───────────────────────────────────────────────────────────
function Tasks.open_new(player)
  local scr = player.gui.screen
  if scr[DIALOG] then
    scr[DIALOG].destroy()
  end
  local f = scr.add({ type = "frame", name = DIALOG, direction = "vertical" })
  f.auto_center = true
  f.style.width = 470

  local tb = f.add({ type = "flow", direction = "horizontal" })
  tb.drag_target = f
  tb.style.horizontal_spacing = 8
  tb.add({ type = "label", caption = "New task", style = "frame_title", ignored_by_interaction = true })
  local dh = tb.add({ type = "empty-widget", style = "draggable_space_header", ignored_by_interaction = true })
  dh.style.horizontally_stretchable = true
  dh.style.height = 24
  tb.add({ type = "sprite-button", name = "pyops_nt_close", sprite = "utility/close", style = "frame_action_button" })

  local c = f.add({ type = "frame", style = "inside_shallow_frame", direction = "vertical" })
  local cb = c.add({ type = "flow", direction = "vertical" })
  cb.style.padding = 12
  cb.style.vertical_spacing = 6
  cb.style.horizontally_stretchable = true

  cb.add({ type = "label", style = "caption_label", caption = "Title" })
  local tf = cb.add({ type = "textfield", name = "pyops_nt_title" })
  tf.style.horizontally_stretchable = true

  cb.add({ type = "label", style = "caption_label", caption = "Description" })
  local desc = cb.add({ type = "text-box", name = "pyops_nt_desc" })
  desc.word_wrap = true
  desc.style.horizontally_stretchable = true
  desc.style.maximal_width = 100000
  desc.style.minimal_height = 70

  cb.add({ type = "line" }).style.top_margin = 4
  local av = cb.add({ type = "flow", direction = "vertical" })
  av.style.vertical_spacing = 6
  av.style.horizontally_stretchable = true
  av.add({ type = "checkbox", name = "pyops_nt_anchor", state = true, caption = "Anchor to what I'm looking at" })
  local chips = av.add({ type = "flow", direction = "horizontal" })
  chips.style.horizontal_spacing = 6
  chips.style.vertical_align = "center"
  local pos = player.position
  local loc = string.format("%s  (%d, %d)", player.surface.name, math.floor(pos.x), math.floor(pos.y))
  chips.add({ type = "label", caption = "[img=utility/map] " .. loc })
  local sel = player.selected
  if sel and sel.valid then
    local spath = "entity/" .. sel.name
    local icon = helpers.is_valid_sprite_path(spath) and ("[img=" .. spath .. "] ") or ""
    chips.add({ type = "label", caption = { "", "·  ", icon, sel.localised_name } })
  else
    chips.add({ type = "label", style = "grey_label", caption = "(hover an entity to anchor it too)" })
  end

  local ft = f.add({ type = "flow", direction = "horizontal" })
  ft.style.top_margin = 8
  ft.style.horizontal_spacing = 8
  ft.add({ type = "button", name = "pyops_nt_cancel", caption = "Cancel", style = "back_button" })
  ft.add({ type = "empty-widget" }).style.horizontally_stretchable = true
  ft.add({ type = "button", name = "pyops_nt_create", caption = "Create task", style = "confirm_button" })
  tf.focus()
end

function Tasks.close_new(player)
  local dlg = player.gui.screen[DIALOG]
  if dlg and dlg.valid then
    dlg.destroy()
  end
end

function Tasks.submit_new(player)
  local dlg = player.gui.screen[DIALOG]
  if not (dlg and dlg.valid) then
    return
  end
  local title_el = find_child(dlg, "pyops_nt_title")
  local desc_el = find_child(dlg, "pyops_nt_desc")
  local anchor_el = find_child(dlg, "pyops_nt_anchor")
  local title = title_el and title_el.text or ""
  if title == "" then
    if title_el then
      title_el.focus()
    end
    return
  end
  local payload = {
    title = title,
    body = desc_el and desc_el.text or "",
    anchor = anchor_el and anchor_el.state or false,
  }
  if payload.anchor then
    payload.surface = player.surface.name
    payload.x = player.position.x
    payload.y = player.position.y
    local entity = nil
    if player.selected and player.selected.valid then
      entity = player.selected.name
    elseif storage.pyops_last_selected and storage.pyops_last_selected[player.index] then
      entity = storage.pyops_last_selected[player.index].name
    end
    payload.entity = entity
  end
  Tasks.send(player, "task.capture", payload)
  dlg.destroy()
end

-- Click dispatch. Returns true if it handled the element.
function Tasks.on_gui_click(player, element)
  local name = element.name
  if not name or name == "" then
    return false
  end
  if string.find(name, "^pyops_task_row_") then
    local id = tonumber(string.sub(name, #"pyops_task_row_" + 1))
    if id then
      set_selected(player, id)
      Tasks.refresh(player)
    end
    return true
  elseif name == "pyops_task_goto" then
    local t = element.tags
    if t and t.x and t.y then
      player.zoom_to_world({ x = t.x, y = t.y })
    end
    return true
  elseif name == "pyops_task_new" then
    Tasks.open_new(player)
    return true
  elseif name == "pyops_task_refresh" then
    Tasks.send(player, "task.list", {})
    return true
  elseif name == "pyops_nt_create" then
    Tasks.submit_new(player)
    return true
  elseif name == "pyops_nt_cancel" or name == "pyops_nt_close" then
    Tasks.close_new(player)
    return true
  end
  return false
end

return Tasks
