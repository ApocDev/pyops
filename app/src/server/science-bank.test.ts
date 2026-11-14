import { describe, expect, it } from "vite-plus/test";
import { computeScienceBank, ratesForTech, type LabProto } from "./science-bank.ts";
import type { BeaconEff, ModuleEff } from "./effects.ts";

// Pyanodons' lab: no module slots of its own, no speed effects, and vatbrains —
// a beacon-delivered productivity module — as its only possible modifier.
const LAB: LabProto = {
  name: "lab",
  researchingSpeed: 1,
  moduleSlots: 0,
  energyUsageW: 60_000,
  drainW: 0,
  allowedEffects: ["consumption", "productivity", "pollution"],
  allowedModuleCategories: ["vatbrain"],
  inputs: ["automation-science-pack", "py-science-pack-1", "logistic-science-pack"],
};

const MODS = new Map<string, ModuleEff>([
  ["vatbrain-4", { effSpeed: 0, effProductivity: 1, effConsumption: 4, category: "vatbrain" }],
  ["speed-module-3", { effSpeed: 1, effProductivity: 0, effConsumption: 1.5, category: "speed" }],
]);
const BEACONS = new Map<string, BeaconEff>([
  [
    "vat-brain",
    { distributionEffectivity: 1, moduleSlots: 1, energyUsageW: 900_000, profile: null },
  ],
  [
    "beacon",
    { distributionEffectivity: 1.5, moduleSlots: 2, energyUsageW: 480_000, profile: null },
  ],
]);

const bank = (over: Partial<Parameters<typeof computeScienceBank>[0]> = {}) =>
  computeScienceBank({
    lab: LAB,
    packs: {},
    labSecondsPerPack: 60,
    labSpeedBonus: 0,
    labProductivityBonus: 0,
    modules: [],
    beacons: [],
    moduleDb: MODS,
    beaconDb: BEACONS,
    ...over,
  });

describe("computeScienceBank — one pool", () => {
  // silver-mk01: automation x3 + logistic x1 + py science 1 x2 per unit, 60 s per
  // unit, so 60/6 = 10 lab-seconds per pack.
  const RATIO_CONSISTENT = {
    "automation-science-pack": 30 / 60,
    "py-science-pack-1": 20 / 60,
    "logistic-science-pack": 10 / 60,
  };

  it("sizes one pool from the total pack rate, not the sum of per-pack pools", () => {
    // 60 packs/min total at 10 lab-seconds each = 600 lab-seconds/min = 10 labs
    expect(bank({ packs: RATIO_CONSISTENT, labSecondsPerPack: 10 }).labs).toBeCloseTo(10, 6);
  });

  // The error that made a recipe per pack unusable: 40/min + 20/min read as
  // 40 + 20 labs when those are the same labs.
  it("does not multiply labs by the number of pack types", () => {
    const split = bank({
      packs: { "automation-science-pack": 40 / 60, "py-science-pack-1": 20 / 60 },
    });
    const lumped = bank({ packs: { "automation-science-pack": 60 / 60 } });
    expect(split.labs).toBeCloseTo(lumped.labs, 6);
  });

  it("agrees with the per-pack reading when rates match a technology ratio", () => {
    // labs for each pack = rate ÷ (amount / unit_time); all equal at U × T
    const perPack = Object.entries(RATIO_CONSISTENT).map(
      ([pack, rate]) =>
        rate /
        ({ "automation-science-pack": 3, "py-science-pack-1": 2, "logistic-science-pack": 1 }[
          pack
        ]! /
          60),
    );
    expect(Math.max(...perPack)).toBeCloseTo(
      bank({ packs: RATIO_CONSISTENT, labSecondsPerPack: 10 }).labs,
      6,
    );
  });

  it("supplies every pack the plan asks for", () => {
    const r = bank({ packs: RATIO_CONSISTENT, labSecondsPerPack: 10 });
    expect(r.packDemand["automation-science-pack"]).toBeCloseTo(30 / 60, 6);
    expect(r.packDemand["logistic-science-pack"]).toBeCloseTo(10 / 60, 6);
    expect(r.totalPerSec).toBeCloseTo(1, 6);
  });
});

describe("ratesForTech", () => {
  // Pyanodons silver-mk01, verbatim from tech_ingredients
  const SILVER = {
    ratio: { "automation-science-pack": 3, "logistic-science-pack": 1, "py-science-pack-1": 2 },
    unitTime: 60,
    unitCount: 175,
  };

  it("turns a technology and a duration into rates to type in", () => {
    // 175 units in 30 minutes
    const r = ratesForTech(SILVER, 30 * 60);
    const units = 175 / (30 * 60);
    expect(r.packs["automation-science-pack"]).toBeCloseTo(units * 3, 9);
    expect(r.packs["py-science-pack-1"]).toBeCloseTo(units * 2, 9);
    expect(r.totalPerSec).toBeCloseTo(units * 6, 9);
  });

  it("derives the pool scalar as unit time spread over the unit's packs", () => {
    expect(ratesForTech(SILVER, 600).labSecondsPerPack).toBeCloseTo(10, 9);
  });

  // The point of computing both together: feeding them straight back gives a
  // pool that finishes the technology in exactly the requested time.
  it("round-trips: its output sizes a pool that hits the deadline", () => {
    const seconds = 30 * 60;
    const derived = ratesForTech(SILVER, seconds);
    const r = bank({ packs: derived.packs, labSecondsPerPack: derived.labSecondsPerPack });
    // total lab-seconds needed = unitCount × unitTime; at `labs` labs that takes
    expect((SILVER.unitCount * SILVER.unitTime) / r.labs).toBeCloseTo(seconds, 3);
  });
});

describe("computeScienceBank — research speed bonus", () => {
  it("scales labs by 1 / (1 + bonus) and leaves pack demand alone", () => {
    const packs = { "automation-science-pack": 40 / 60 };
    const plain = bank({ packs });
    const researched = bank({ packs, labSpeedBonus: 2.5 });
    expect(researched.labs).toBeCloseTo(plain.labs / 3.5, 9);
    expect(researched.packDemand).toEqual(plain.packDemand);
    expect(researched.labSpeedBonus).toBe(2.5);
  });
});

describe("computeScienceBank — research productivity bonus", () => {
  const packs = { "automation-science-pack": 40 / 60 };

  it("scales pack demand and labs by 1 / (1 + bonus)", () => {
    const plain = bank({ packs });
    const researched = bank({ packs, labProductivityBonus: 0.5 });
    expect(researched.packDemand["automation-science-pack"]).toBeCloseTo(40 / 60 / 1.5, 9);
    expect(researched.labs).toBeCloseTo(plain.labs / 1.5, 9);
    expect(researched.productivityMult).toBeCloseTo(1.5, 9);
  });

  it("adds to module productivity rather than multiplying with it", () => {
    // vatbrain-4 in one beacon gives +100%; +50% research makes +150%, not 3x
    const r = bank({
      packs,
      labProductivityBonus: 0.5,
      beacons: [{ beacon: "vat-brain", modules: ["vatbrain-4"], count: 1 }],
    });
    expect(r.productivityMult).toBeCloseTo(2.5, 9);
    expect(r.packDemand["automation-science-pack"]).toBeCloseTo(40 / 60 / 2.5, 9);
  });
});

describe("computeScienceBank — effects", () => {
  const withVatbrain = (shared?: number) =>
    bank({
      packs: { "automation-science-pack": 40 / 60 },
      beacons: [{ beacon: "vat-brain", modules: ["vatbrain-4"], count: 1, shared }],
    });

  // Entered rates are post-effects: you name the research you want, and the
  // block derives the smaller pack supply that achieves it.
  it("divides pack demand by productivity and halves the pool", () => {
    const plain = bank({ packs: { "automation-science-pack": 40 / 60 } });
    const boosted = withVatbrain();
    expect(boosted.productivityMult).toBeCloseTo(2);
    expect(boosted.packDemand["automation-science-pack"]).toBeCloseTo(20 / 60, 6);
    expect(boosted.labs).toBeCloseTo(plain.labs / 2, 6);
  });

  // Measured in game: Py's lab next to a beacon with 2 × speed-module-3 kept
  // effects {} and researched at its unbeaconed rate.
  it("ignores a speed beacon, since the lab allows no speed", () => {
    const plain = bank({ packs: { "automation-science-pack": 40 / 60 } });
    const beaconed = bank({
      packs: { "automation-science-pack": 40 / 60 },
      beacons: [{ beacon: "beacon", modules: ["speed-module-3", "speed-module-3"], count: 1 }],
    });
    expect(beaconed.speedMult).toBe(1);
    expect(beaconed.labs).toBeCloseTo(plain.labs, 9);
  });

  it("charges beacon upkeep per building, so sharing reduces the drain", () => {
    const upkeepDb = new Map([
      ["vat-brain\0vatbrain-4", { item: "brain-cartridge-04", kind: "item", perSec: 0.05 }],
    ]);
    const key = (b: string, m: string) => `${b}\0${m}`;
    const priv = computeScienceBank({
      lab: LAB,
      packs: { "automation-science-pack": 40 / 60 },
      labSecondsPerPack: 60,
      labSpeedBonus: 0,
      labProductivityBonus: 0,
      modules: [],
      beacons: [{ beacon: "vat-brain", modules: ["vatbrain-4"], count: 1, shared: 1 }],
      moduleDb: MODS,
      beaconDb: BEACONS,
      upkeepDb,
      upkeepKey: key,
    });
    const shared = computeScienceBank({
      lab: LAB,
      packs: { "automation-science-pack": 40 / 60 },
      labSecondsPerPack: 60,
      labSpeedBonus: 0,
      labProductivityBonus: 0,
      modules: [],
      beacons: [{ beacon: "vat-brain", modules: ["vatbrain-4"], count: 1, shared: 20 }],
      moduleDb: MODS,
      beaconDb: BEACONS,
      upkeepDb,
      upkeepKey: key,
    });
    // 20 labs after productivity: 20 buildings private, 1 when shared by 20
    expect(priv.beaconBuildings).toEqual([{ beacon: "vat-brain", count: 20 }]);
    expect(shared.beaconBuildings).toEqual([{ beacon: "vat-brain", count: 1 }]);
    expect(priv.upkeep["brain-cartridge-04"]!.perSec).toBeCloseTo(20 * 0.05, 6);
    expect(shared.upkeep["brain-cartridge-04"]!.perSec).toBeCloseTo(0.05, 6);
  });

  it("scales the pool with the lab's own research speed", () => {
    const fast = bank({
      lab: { ...LAB, researchingSpeed: 4 },
      packs: { "automation-science-pack": 40 / 60 },
    });
    expect(fast.labs).toBeCloseTo(10, 6);
  });

  it("charges a lab's electric drain on whole labs", () => {
    // 2.5 labs of work on 3 placed labs, 10 kW drain each
    const r = bank({
      lab: { ...LAB, drainW: 10_000 },
      packs: { "automation-science-pack": 2.5 / 60 },
    });
    expect(r.labs).toBeCloseTo(2.5, 6);
    expect(r.totalPowerW).toBeCloseTo(2.5 * 60_000 + 3 * 10_000, 3);
  });

  it("scales the pool with lab-seconds per pack", () => {
    const slow = bank({ packs: { "automation-science-pack": 40 / 60 }, labSecondsPerPack: 300 });
    expect(slow.labs).toBeCloseTo(200, 6);
  });
});

describe("computeScienceBank — edges", () => {
  it("reports packs the chosen lab cannot accept", () => {
    const r = bank({ packs: { "automation-science-pack": 1, "space-science-pack": 1 } });
    expect(r.unsupported).toEqual(["space-science-pack"]);
  });

  it("is empty and costs nothing with no packs requested", () => {
    const r = bank();
    expect(r.labs).toBe(0);
    expect(r.totalPerSec).toBe(0);
    expect(r.totalPowerW).toBe(0);
    expect(r.packDemand).toEqual({});
  });

  it("ignores zero and negative rates", () => {
    const r = bank({ packs: { "automation-science-pack": 0, "py-science-pack-1": -5 } });
    expect(r.labs).toBe(0);
    expect(r.packDemand).toEqual({});
  });
});
