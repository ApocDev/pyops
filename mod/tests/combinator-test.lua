-- factorio-test suite for combinator.lua's pure helpers.
--
-- Runs IN the game (factorio-test loads it via control.lua), but every function
-- under test is a game-free table/string transform exposed on Combinator._internal,
-- so the assertions are deterministic. See mod/tests/README.md to run.
--
-- Syntax: factorio-test is busted-style (test/describe + bundled luassert).

local I = require("combinator")._internal

describe("group_add", function()
  test("creates a group on first add and counts it", function()
    local groups = {}
    local g = I.group_add(groups, "iron", "Iron", 60)
    assert.equals(1, g.count)
    assert.equals(60, g.amount)
    assert.equals("Iron", g.label)
    assert.equals(g, groups["iron"]) -- stored under its key
  end)

  test("accumulates count and amount across repeated adds", function()
    local groups = {}
    I.group_add(groups, "iron", "Iron", 60)
    local g = I.group_add(groups, "iron", "Iron", 40)
    assert.equals(2, g.count)
    assert.equals(100, g.amount)
  end)

  test("carries the optional fluid tag", function()
    local groups = {}
    local g = I.group_add(groups, "water@15", "Water", 1000, "water")
    assert.equals("water", g.fluid)
  end)
end)

describe("sorted_groups", function()
  test("flattens the keyed map into a list ordered by amount, biggest first", function()
    local groups = {}
    I.group_add(groups, "a", "A", 10)
    I.group_add(groups, "b", "B", 50)
    I.group_add(groups, "c", "C", 30)
    local arr = I.sorted_groups(groups)
    assert.equals(3, #arr)
    assert.equals("b", arr[1].key)
    assert.equals("c", arr[2].key)
    assert.equals("a", arr[3].key)
  end)
end)

describe("measured_totals", function()
  test("sums item slots into one pool and caps fluids per-fluid", function()
    local s = {
      item_groups = {
        { key = "iron", amount = 60 },
        { key = "copper", amount = 40 },
      },
      fluid_groups = {
        { key = "water@15", amount = 1000, fluid = "water" },
        { key = "water@90", amount = 500, fluid = "water" },
        { key = "oil", amount = 200, fluid = "crude-oil" },
      },
    }
    local slots, caps = I.measured_totals(s)
    assert.equals(100, slots)
    assert.equals(1500, caps["water"]) -- both water temps share one cap
    assert.equals(200, caps["crude-oil"])
  end)

  test("excludes groups the player unchecked", function()
    local s = {
      excluded = { copper = true, oil = true },
      item_groups = {
        { key = "iron", amount = 60 },
        { key = "copper", amount = 40 },
      },
      fluid_groups = {
        { key = "oil", amount = 200, fluid = "crude-oil" },
      },
    }
    local slots, caps = I.measured_totals(s)
    assert.equals(60, slots) -- copper dropped
    assert.is_nil(caps["crude-oil"]) -- oil dropped
  end)

  test("tolerates missing group lists", function()
    local slots, caps = I.measured_totals({})
    assert.equals(0, slots)
    assert.same({}, caps)
  end)
end)

describe("totals_caption", function()
  test("renders a localised slots + fluid summary", function()
    local cap = I.totals_caption(100, { water = 1000, ["crude-oil"] = 500 })
    assert.equals("100", cap[3])
    assert.equals("1500", cap[5]) -- total fluid, %.0f
  end)
end)

describe("network_signal", function()
  test("maps a bare letter to its virtual signal", function()
    assert.equals("signal-A", I.network_signal("a"))
    assert.equals("signal-B", I.network_signal("B"))
  end)

  test("trims surrounding whitespace before matching", function()
    assert.equals("signal-C", I.network_signal("  c "))
  end)

  test("passes a multi-character name through unchanged", function()
    assert.equals("iron-plate", I.network_signal("iron-plate"))
  end)

  test("defaults empty/blank input to signal-A", function()
    assert.equals("signal-A", I.network_signal(""))
    assert.equals("signal-A", I.network_signal(nil))
  end)
end)
