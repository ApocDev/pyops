-- Pure formatting helpers shared by the Blocks board (blocks.lua) and the build
-- sheet (summary.lua). Game-free, so mod/tests/format-test.lua covers them.

local Format = {}

-- Precise rate for tooltips.
function Format.rate(rate)
  if rate >= 100 then
    return string.format("%.1f", rate)
  elseif rate >= 1 then
    return string.format("%.2f", rate)
  end
  return string.format("%.3f", rate)
end

-- Compact number for a label under a slot: integers plain, sub-1 with just enough
-- decimals, trailing zeros trimmed (so 1→"1", 0.10→"0.1", 0.06→"0.06").
function Format.num(n)
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

-- A block's display units (the web's goal time unit). Rates travel per second.
local UNITS = {
  s = { 1, "/s" },
  min = { 60, "/min" },
  h = { 3600, "/h" },
}

-- Convert a per-second rate into the block's display unit. Returns the value and
-- its suffix ("/s", "/min", "/h"); an unknown unit stays per second.
function Format.in_unit(rate, unit)
  local u = UNITS[unit] or UNITS.s
  return (rate or 0) * u[1], u[2]
end

-- The number to put on a block's slot (sprite-button.number), or nil for none.
-- The engine prints one decimal, so anything under 0.1 would read "0.0".
function Format.slot_number(value)
  if not value or value < 0.1 then
    return nil
  end
  return value
end

-- Built state from whole-machine counts: "done" (everything placed), "partial"
-- (some placed) or "none" (nothing placed, or a block that needs no machines).
function Format.build_state(have, need)
  if not need or need <= 0 then
    return "none"
  end
  if (have or 0) >= need then
    return "done"
  end
  if (have or 0) > 0 then
    return "partial"
  end
  return "none"
end

-- Power for headers and tooltips: "9.2 MW", "450 kW", "1.25 GW".
function Format.power(watts)
  watts = watts or 0
  if watts >= 1e9 then
    return string.format("%.2f GW", watts / 1e9)
  elseif watts >= 1e6 then
    return string.format("%.1f MW", watts / 1e6)
  end
  return string.format("%.0f kW", watts / 1e3)
end

-- Case-insensitive plain-text match for the board's search box ("" matches all).
function Format.matches(name, query)
  if not query or query == "" then
    return true
  end
  return string.find(string.lower(name or ""), string.lower(query), 1, true) ~= nil
end

-- The PyOps panel's width in logical pixels: `preferred`, but never wider than
-- the screen's logical width minus a margin on each side. Never under 320, which
-- keeps a few slot columns on very small screens.
function Format.panel_width(screen_width, preferred, margin)
  return math.max(320, math.min(preferred, math.floor(screen_width - 2 * margin)))
end

-- Blocks board layout for a panel width (logical px): the folder-label width and
-- how many 40px slots fit per row (1..10). About 80px goes to the frame, scroll
-- bar, and paddings around the board.
function Format.board_layout(panel_width)
  local label = panel_width >= 560 and 170 or 100
  local columns = math.floor((panel_width - label - 12 - 80) / 40)
  return label, math.max(1, math.min(10, columns))
end

-- Where a new build sheet goes beside the panel, in screen pixels: right of the
-- panel when it fits, else left of it, else nil (let the caller center it).
-- `sheet` is an estimate of the sheet's width, since GUI sizes can't be read.
function Format.beside_x(panel_x, panel_px, sheet_px, screen_px, gap)
  local right = panel_x + panel_px + gap
  if right + sheet_px <= screen_px then
    return right
  end
  local left = panel_x - gap - sheet_px
  if left >= 0 then
    return left
  end
  return nil
end

-- Connection dot state from ticks since the last pong (or since the panel opened,
-- whichever is later): nil while fresh (keep what the last pong set), then
-- "connecting" after 5 s, then "no_app" after 15 s.
function Format.link_state(age_ticks)
  if age_ticks > 900 then
    return "no_app"
  elseif age_ticks > 300 then
    return "connecting"
  end
  return nil
end

return Format
