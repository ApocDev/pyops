-- PyOps custom GUI styles.
--
-- Everything here is defined at the data stage (it can't be created at runtime),
-- so it's deliberately GENEROUS: a broad palette we can compose live via the
-- in-game designer without further reloads. Two sprites do all the work — a white
-- pixel (solid fills) and a white rounded square (pills/cards) — tinted per color.
--
-- ORGANISATION: styles are split into two regions so the final mod can be trimmed
-- without archaeology:
--   * IN USE   — styles the shipped panel actually references. Promote here as we
--                adopt a style in control.lua.
--   * PALETTE  — candidates generated for design exploration. Anything still here
--                when we ship is dead weight and can be deleted wholesale.

local styles = data.raw["gui-style"].default
local GFX = "__pyops__/graphics/"

-- ── Tinted graphical-set helpers ────────────────────────────────────────────
-- round(): 9-sliced rounded fill (corner_size 8 on the 32px sprite).
-- solid(): stretched flat fill from the 8px white pixel.
local function round(col, a)
  return { base = { filename = GFX .. "pyops-round.png", position = { 0, 0 }, size = 32, corner_size = 8, tint = { col[1], col[2], col[3], a or 1 } } }
end
local function solid(col, a)
  return { base = { filename = GFX .. "pyops-pixel.png", position = { 0, 0 }, size = 8, corner_size = 2, tint = { col[1], col[2], col[3], a or 1 } } }
end

-- ── Palette ─────────────────────────────────────────────────────────────────
-- Named colors. Add freely — each one fans out into a chip / badge / text / bar
-- via the loop below.
-- Colors mirror the web app's status/priority palette (Tailwind) so the two
-- surfaces read identically: amber-400, emerald-500, slate-500, etc.
local PALETTE = {
  red    = { 0.86, 0.30, 0.30 },
  amber  = { 0.98, 0.75, 0.14 }, -- amber-400
  green  = { 0.06, 0.72, 0.51 }, -- emerald-500
  blue   = { 0.38, 0.62, 0.94 },
  slate  = { 0.39, 0.45, 0.55 }, -- slate-500 (status: closed/complete)
  teal   = { 0.28, 0.74, 0.70 },
  purple = { 0.66, 0.50, 0.90 },
  grey   = { 0.56, 0.59, 0.63 },
  dim    = { 0.34, 0.36, 0.40 },
}

-- ============================================================================
-- IN USE  (styles the shipped panel references — promote here as we adopt them)
-- ============================================================================
-- (nothing yet — we're still designing against the PALETTE below)

-- ============================================================================
-- PALETTE  (design candidates — safe to delete any unused ones before shipping)
-- ============================================================================

-- Light fills (amber) need dark text for legible contrast; everything else takes
-- white. Applied to the filled states of chips/badges.
local DARK_TEXT = { amber = true }

-- Per-color family: a toggle chip, a static pill badge, colored text, a solid bar.
for name, col in pairs(PALETTE) do
  local on_fill = DARK_TEXT[name] and { 0.13, 0.10, 0.04 } or { 1, 1, 1 }
  -- Toggle/filter chip: faint when idle, fills with the color when .toggled.
  styles["pyops_chip_" .. name] = {
    type = "button_style",
    parent = "button",
    font = "default-semibold",
    default_font_color = { 0.88, 0.90, 0.93 },
    selected_font_color = on_fill,
    height = 24,
    minimal_width = 0,
    top_padding = 0,
    bottom_padding = 0,
    left_padding = 9,
    right_padding = 9,
    default_graphical_set = round({ 0.5, 0.52, 0.56 }, 0.10),
    hovered_graphical_set = round(col, 0.40),
    clicked_graphical_set = round(col, 0.60),
    selected_graphical_set = round(col, 0.85),
    selected_hovered_graphical_set = round(col, 0.95),
    selected_clicked_graphical_set = round(col, 1.00),
  }

  -- Static pill badge (carries its own caption) for priority / status tags.
  styles["pyops_badge_" .. name] = {
    type = "button_style",
    parent = "button",
    font = "default-small-semibold",
    default_font_color = on_fill,
    hovered_font_color = on_fill,
    clicked_font_color = on_fill,
    height = 18,
    minimal_width = 0,
    top_padding = 0,
    bottom_padding = 0,
    left_padding = 7,
    right_padding = 7,
    default_graphical_set = round(col, 0.90),
    hovered_graphical_set = round(col, 0.90),
    clicked_graphical_set = round(col, 0.90),
  }

  -- Colored label text.
  styles["pyops_text_" .. name] = {
    type = "label_style",
    parent = "label",
    font_color = col,
  }

  -- Thin solid color bar — left accent on a row, divider, status dot.
  styles["pyops_bar_" .. name] = {
    type = "empty_widget_style",
    graphical_set = solid(col, 1),
    width = 4,
  }
end

-- ── Headings / muted text ───────────────────────────────────────────────────
styles["pyops_h1"] = {
  type = "label_style",
  parent = "frame_title",
  font = "default-large-bold",
  font_color = { 0.97, 0.86, 0.62 },
}
styles["pyops_h2"] = {
  type = "label_style",
  parent = "label",
  font = "default-semibold",
  font_color = { 0.74, 0.78, 0.84 },
  top_padding = 4,
}
styles["pyops_muted"] = {
  type = "label_style",
  parent = "label",
  font_color = { 0.60, 0.63, 0.68 },
}
styles["pyops_muted_small"] = {
  type = "label_style",
  parent = "label",
  font = "default-small",
  font_color = { 0.58, 0.61, 0.66 },
}

-- ── Cards / sections / rows ─────────────────────────────────────────────────
-- Subtle rounded card to group detail sections / block summaries.
styles["pyops_card"] = {
  type = "frame_style",
  graphical_set = round({ 0.10, 0.11, 0.13 }, 0.55),
  padding = 8,
  vertically_stretchable = "off",
}
-- Inset (darker) card for nested content.
styles["pyops_card_inset"] = {
  type = "frame_style",
  graphical_set = round({ 0.04, 0.05, 0.06 }, 0.65),
  padding = 6,
}

-- NOTE: Factorio ignores the alpha channel of a style `tint` (verified in-game) —
-- a tinted-white fill renders OPAQUE white, not faint. So "transparent" must mean
-- an empty graphical_set, and translucency has to come from the color itself, not
-- a low alpha. The styles below follow that rule.

-- Selectable task row. Transparent normally (use a plain flow, or this empty-bg
-- frame); faint blue highlight when it's the active task.
styles["pyops_row"] = {
  type = "frame_style",
  graphical_set = {}, -- truly transparent (tint-alpha would render white)
  horizontally_stretchable = "on",
  top_padding = 2,
  bottom_padding = 2,
  left_padding = 4,
  right_padding = 4,
}
styles["pyops_row_selected"] = {
  type = "frame_style",
  parent = "pyops_row",
  graphical_set = round({ 0.22, 0.34, 0.52 }, 1), -- opaque muted blue (reads as a highlight over the dark list)
}

-- Toolbar strip background — reuse the engine's inset subheader look rather than a
-- tinted fill (which can't be made faint via alpha).
styles["pyops_toolbar"] = {
  type = "frame_style",
  parent = "subheader_frame",
  horizontally_stretchable = "on",
}

-- Neutral toggle (e.g. the Flat/Grouped view switch) — nicer than bare tool_button.
styles["pyops_toggle"] = {
  type = "button_style",
  parent = "tool_button",
  default_graphical_set = round({ 0.5, 0.52, 0.56 }, 0.10),
  hovered_graphical_set = round({ 0.5, 0.52, 0.56 }, 0.20),
  selected_graphical_set = round({ 0.38, 0.62, 0.94 }, 0.80),
  selected_hovered_graphical_set = round({ 0.38, 0.62, 0.94 }, 0.90),
}
