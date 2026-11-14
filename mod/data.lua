data:extend({
  {
    type = "custom-input",
    name = "pyops-toggle-panel",
    key_sequence = "CONTROL + SHIFT + P",
    consuming = "none",
    action = "lua"
  },
  {
    type = "custom-input",
    name = "pyops-toggle-debug",
    key_sequence = "CONTROL + SHIFT + D",
    consuming = "none",
    action = "lua"
  },
  -- Sushi-loop tools: trace + wire the hovered belt's loop; undo the last trace.
  {
    type = "custom-input",
    name = "pyops-trace-sushi",
    key_sequence = "ALT + B",
    consuming = "none",
    action = "lua"
  },
  {
    type = "custom-input",
    name = "pyops-untrace-sushi",
    key_sequence = "SHIFT + ALT + B",
    consuming = "none",
    action = "lua"
  },
  -- Focus: open the block that runs the hovered machine's recipe in the web app.
  -- A key press reads `player.selected` (the reverse of the web's locate).
  {
    type = "custom-input",
    name = "pyops-focus-block",
    key_sequence = "CONTROL + SHIFT + O",
    consuming = "none",
    action = "lua"
  },
  -- Mirrors the smart-pipette (Q) key so the summary panel can pipette the good /
  -- building under the cursor. Linked (no own key) — it fires alongside the normal
  -- pipette, which still works everywhere else.
  {
    type = "custom-input",
    name = "pyops-pipette",
    key_sequence = "",
    linked_game_control = "pipette",
    action = "lua"
  },
  {
    type = "sprite",
    name = "pyops-logo",
    filename = "__pyops__/graphics/pyops-logo-x128.png",
    size = 128,
    flags = { "gui-icon" }
  },
  {
    type = "shortcut",
    name = "pyops-toggle-panel",
    order = "a[pyops]",
    action = "lua",
    associated_control_input = "pyops-toggle-panel",
    toggleable = true,
    icon = "__pyops__/graphics/pyops-shortcut-x32.png",
    icon_size = 32,
    small_icon = "__pyops__/graphics/pyops-shortcut-x24.png",
    small_icon_size = 24
  },
  -- Selection tool handed to the cursor by the summary panel's "Create request
  -- combinator" button. Dragging it over a station + its holding chests/tanks
  -- lets the mod measure real storage to size the request combinator. Cursor-only
  -- and hidden — it's never crafted or kept in inventory.
  {
    type = "selection-tool",
    name = "pyops-combinator-planner",
    icon = "__pyops__/graphics/pyops-shortcut-x32.png",
    icon_size = 32,
    flags = { "only-in-cursor", "not-stackable" },
    hidden = true,
    stack_size = 1,
    -- Pumps are needed to read fluid filters (which fluid each tank chain holds);
    -- chests/tanks are the storage. Loaders/inserters in the drag are simply not
    -- returned. Loader-pipe "tanks" are filtered out in script by prototype flags.
    select = {
      border_color = { r = 0.3, g = 0.6, b = 1 },
      cursor_box_type = "entity",
      mode = { "any-entity" },
      entity_filter_mode = "whitelist",
      entity_type_filters = { "container", "logistic-container", "storage-tank", "pump", "train-stop" }
    },
    alt_select = {
      border_color = { r = 0.3, g = 0.8, b = 0.4 },
      cursor_box_type = "entity",
      mode = { "any-entity" },
      entity_filter_mode = "whitelist",
      entity_type_filters = { "container", "logistic-container", "storage-tank", "pump", "train-stop" }
    }
  }
})

-- The mod's only custom GUI styles. Everything else in the panel uses vanilla
-- styles. The build sheet's zebra-striped rows give Helmod's "Production block"
-- its banded look; the odd-row graphical set is drawn from core graphics.
local styles = data.raw["gui-style"].default

-- Top-left mod-gui button. `mod_gui_button` is the flat light-gray button face,
-- which shows through around our transparent logo; inheriting from `slot_button`
-- gives the recessed dark item-slot look the other mods' top buttons have.
styles["pyops_mod_gui_button"] = {
  type = "button_style",
  parent = "slot_button",
  size = 40,
}

styles["pyops_matrix_table"] = {
  type = "table_style",
  hovered_row_color = { r = 0.98, g = 0.66, b = 0.22, a = 0.7 },
  cell_padding = 2,
  vertical_align = "top",
  horizontal_spacing = 10,
  vertical_spacing = 2,
  odd_row_graphical_set = {
    type = "composition",
    filename = "__core__/graphics/gui.png",
    corner_size = { 1, 1 },
    position = { 78, 18 },
    opacity = 0.7,
  },
}
