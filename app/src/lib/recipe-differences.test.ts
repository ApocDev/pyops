import { describe, expect, it } from "vite-plus/test";
import { recipeDifferences, type RecipeVariant } from "./recipe-differences";

// Py's five "Iron plate" recipes, ingredients in dump order.
const IRON_PLATE: RecipeVariant[] = [
  { name: "iron-plate", display: "Iron plate", inputs: ["Iron ore"], machine: "Stone furnace" },
  {
    name: "iron-oxide-smelting",
    display: "Iron plate",
    inputs: ["Iron oxide"],
    machine: "Stone furnace",
  },
  {
    name: "iron-plate-1",
    display: "Iron plate",
    inputs: ["Molten iron", "Borax", "Sand casting"],
    machine: "Casting unit MK 01",
  },
  {
    name: "low-grade-smelting-iron",
    display: "Iron plate",
    inputs: ["Processed iron ore"],
    machine: "Stone furnace",
  },
  {
    name: "hotair-iron-plate-1",
    display: "Iron plate",
    inputs: ["Molten iron", "Borax", "Sand casting", "Hot air"],
    machine: "Casting unit MK 01",
  },
];

describe("recipeDifferences", () => {
  it("names the main input, then only what sets a recipe apart", () => {
    expect(Object.fromEntries(recipeDifferences(IRON_PLATE))).toEqual({
      "iron-plate": "from Iron ore",
      "iron-oxide-smelting": "from Iron oxide",
      "iron-plate-1": "from Molten iron",
      "low-grade-smelting-iron": "from Processed iron ore",
      "hotair-iron-plate-1": "from Molten iron + Hot air",
    });
  });

  it("skips recipes whose display name is unique", () => {
    const steel = { name: "steel-plate", display: "Steel plate", inputs: ["Iron plate"] };
    const out = recipeDifferences([...IRON_PLATE, steel]);
    expect(out.has("steel-plate")).toBe(false);
    expect(out.size).toBe(IRON_PLATE.length);
  });

  it("never names an input every look-alike shares", () => {
    // Kicalk farm tiers all take seeds + clay; the saline variant adds saline water
    const out = recipeDifferences([
      { name: "kicalk-1", display: "Kicalk", inputs: ["Kicalk seeds", "Clay"] },
      {
        name: "kicalk-1-saline",
        display: "Kicalk",
        inputs: ["Kicalk seeds", "Clay", "Saline water"],
      },
    ]);
    expect(out.get("kicalk-1-saline")).toBe("from Saline water");
    // nothing kicalk-1 has is missing from its look-alike
    expect(out.has("kicalk-1")).toBe(false);
  });

  it("falls back to the machine when inputs can't tell recipes apart", () => {
    // tiered powerplants all heat the same Molten Salt
    const out = recipeDifferences([
      {
        name: "coal-molten-salt-01",
        display: "Hot Molten Salt",
        inputs: ["Molten Salt"],
        machine: "Coal powerplant",
      },
      {
        name: "coal-molten-salt-02",
        display: "Hot Molten Salt",
        inputs: ["Molten Salt"],
        machine: "Coal powerplant MK 02",
      },
      {
        name: "biomass-molten-salt-01",
        display: "Hot Molten Salt",
        inputs: ["Molten Salt", "Biocrud"],
        machine: "Biomass powerplant",
      },
    ]);
    expect(out.get("coal-molten-salt-01")).toBe("Coal powerplant");
    expect(out.get("coal-molten-salt-02")).toBe("Coal powerplant MK 02");
    expect(out.get("biomass-molten-salt-01")).toBe("from Biocrud");
  });

  it("caps the label at three inputs", () => {
    const out = recipeDifferences([
      { name: "a", display: "X", inputs: ["A", "B", "C", "D"] },
      { name: "b", display: "X", inputs: ["B", "C", "D"] },
      { name: "c", display: "X", inputs: ["A", "C", "D"] },
      { name: "d", display: "X", inputs: ["A", "B", "D"] },
      { name: "e", display: "X", inputs: ["A", "B", "C"] },
    ]);
    expect(out.get("a")).toBe("from A + B + C");
  });
});
