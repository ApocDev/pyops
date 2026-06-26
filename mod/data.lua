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

-- Custom GUI styles for the in-game block summary. The zebra-striped rows are
-- what give Helmod's "Production block" its clean banded look; the odd-row
-- graphical set is drawn from core graphics, so we ship no images of our own.
local styles = data.raw["gui-style"].default

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

-- The number tucked under each good icon (Helmod renders these as labels, not the
-- engine's .number overlay, so small rates read as "0.06" instead of "0.0").
styles["pyops_cell_number"] = {
  type = "label_style",
  parent = "label",
  font = "default-small",
  top_padding = -4,
  bottom_padding = 0,
  left_padding = 0,
  right_padding = 0,
  horizontal_align = "center",
  minimal_width = 40,
  maximal_width = 40,
}

-- The PyOps panel style kit (pills, badges, cards, rows, toggles). Kept in its own
-- file so the design-time palette can be trimmed independently before shipping.
require("gui-styles")
