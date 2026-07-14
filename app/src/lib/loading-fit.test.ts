import { describe, expect, it } from "vite-plus/test";
import { loadingFit } from "./loading-fit.ts";
import type { ResolvedLogistics } from "./logistics.ts";

const logistics: ResolvedLogistics = {
  belt: { name: "transport-belt", display: "Transport belt", speed: 0.03125 },
  placedStack: 1,
  moverKind: "inserter",
  inserter: {
    name: "inserter",
    display: "Inserter",
    rotationSpeed: 0.02,
    extensionSpeed: 0.035,
    pickupX: 0,
    pickupY: -1,
    dropX: 0,
    dropY: 1.19921875,
    bulk: false,
    baseStackBonus: 0,
    maxBeltStackSize: 1,
  },
  handStack: 1,
};

const stream = (name: string, rate: number, direction: "input" | "output", kind = "item") => ({
  name,
  rate,
  direction,
  kind,
});

describe("loadingFit", () => {
  it("recommends four 3x3 burner assemblers for block 28 Small parts", () => {
    const fit = loadingFit({
      logistics,
      machineCount: 0.8375,
      tileWidth: 3,
      tileHeight: 3,
      ingredients: [
        stream("iron-gear-wheel", 4.1875, "input"),
        stream("copper-cable", 12.5625, "input"),
        stream("bolts", 12.5625, "input"),
      ],
      products: [stream("small-parts-01", 8.375, "output")],
      fuel: { name: "wood", kind: "item", rate: 0.03140625 },
    });

    expect(fit).toMatchObject({
      capacityBuildings: 1,
      recommendedBuildings: 4,
      accessSlots: 12,
      itemSlots: 10,
      fluidSlots: 0,
      usedSlots: 10,
    });
  });

  it("keeps the capacity building count when its whole movers already fit", () => {
    const fit = loadingFit({
      logistics,
      machineCount: 2.2,
      tileWidth: 3,
      tileHeight: 3,
      ingredients: [stream("ore", 3, "input")],
      products: [stream("plate", 3, "output")],
      fuel: null,
    });
    expect(fit).toMatchObject({
      capacityBuildings: 3,
      recommendedBuildings: 3,
      usedSlots: 2,
    });
  });

  it("reserves active fluid ports and burnt-result extraction", () => {
    const fit = loadingFit({
      logistics,
      machineCount: 1,
      tileWidth: 2,
      tileHeight: 2,
      ingredients: [stream("ore", 1, "input"), stream("water", 10, "input", "fluid")],
      products: [stream("steam", 10, "output", "fluid")],
      fuel: {
        name: "coal",
        kind: "item",
        rate: 0.1,
        burnt: { name: "ash", rate: 0.1 },
      },
    });
    expect(fit).toMatchObject({
      recommendedBuildings: 1,
      itemSlots: 3,
      fluidSlots: 2,
      usedSlots: 5,
      accessSlots: 8,
    });
  });

  it("reports no fit when minimum per-stream access exceeds the perimeter", () => {
    const ingredients = Array.from({ length: 8 }, (_, i) => stream(`input-${i}`, 0.1, "input"));
    const fit = loadingFit({
      logistics,
      machineCount: 1,
      tileWidth: 1,
      tileHeight: 1,
      ingredients,
      products: [],
      fuel: null,
    });
    expect(fit).toMatchObject({
      recommendedBuildings: null,
      accessSlots: 4,
      usedSlots: 8,
    });
  });

  it("returns null for legacy machine rows without a footprint", () => {
    expect(
      loadingFit({
        logistics,
        machineCount: 1,
        tileWidth: null,
        tileHeight: null,
        ingredients: [stream("ore", 1, "input")],
        products: [],
        fuel: null,
      }),
    ).toBeNull();
  });
});
