import { describe, expect, it } from "vite-plus/test";
import { pickAutoModules, type ModuleCandidate } from "./module-fill.server.ts";

const mod = (name: string, eff: Partial<Omit<ModuleCandidate, "name">>): ModuleCandidate => ({
  name,
  effSpeed: 0,
  effProductivity: 0,
  effConsumption: 0,
  ...eff,
});

const prod = mod("prod-1", { effProductivity: 0.04, effSpeed: -0.05, effConsumption: 0.4 });
const prod2 = mod("prod-2", { effProductivity: 0.06, effSpeed: -0.05, effConsumption: 0.6 });
const speed = mod("speed-1", { effSpeed: 0.2, effConsumption: 0.5 });
const eff = mod("eff-1", { effConsumption: -0.3 });

describe("pickAutoModules", () => {
  it("fills every slot with the best productivity module when allowed", () => {
    const fill = pickAutoModules({
      slots: 3,
      allowProductivity: true,
      pool: [prod, prod2, speed, eff],
      baseCount: 4.2,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["prod-2", "prod-2", "prod-2"]);
  });

  it("uses all speed slots when every one still shaves toward the floor", () => {
    // 3.4 buildings, 4 slots of +20%: floor = ceil(3.4/1.8) = 2; only k=4
    // reaches it (3.4/1.6 = 2.125 at k=3) → all four slots go to speed
    const fill = pickAutoModules({
      slots: 4,
      allowProductivity: false,
      pool: [speed, eff],
      baseCount: 3.4,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["speed-1", "speed-1", "speed-1", "speed-1"]);
  });

  it("stops adding speed once the floor is reached and fills the rest with efficiency", () => {
    // 1.92 buildings, strong +50% modules: floor = ceil(1.92/3) = 1;
    // k=2 → 1.92/2 = 0.96 ≤ 1 → 2 speed + 2 efficiency
    const strong = mod("speed-3", { effSpeed: 0.5, effConsumption: 0.7 });
    const fill = pickAutoModules({
      slots: 4,
      allowProductivity: false,
      pool: [strong, eff],
      baseCount: 1.92,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["speed-3", "speed-3", "eff-1", "eff-1"]);
  });

  it("goes all-efficiency when the row is already under one building", () => {
    const fill = pickAutoModules({
      slots: 2,
      allowProductivity: false,
      pool: [speed, eff],
      baseCount: 0.8,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["eff-1", "eff-1"]);
  });

  it("goes all-efficiency when speed modules are too weak to shave a whole building", () => {
    // 1.92 buildings, 2 slots of +10%: best case 1.92/1.2 = 1.6 → floor 2 —
    // zero speed modules already achieve 2 buildings, so speed is pure waste
    const weak = mod("speed-0", { effSpeed: 0.1, effConsumption: 0.3 });
    const fill = pickAutoModules({
      slots: 2,
      allowProductivity: false,
      pool: [weak, eff],
      baseCount: 1.92,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["eff-1", "eff-1"]);
  });

  it("counts beacon speed toward the floor (beaconed rows shed speed modules)", () => {
    // 2 slots of +20%, 2.8 buildings, no beacons: floor = ceil(2.8/1.4) = 2,
    // reached only with both slots on speed
    const noBeacons = pickAutoModules({
      slots: 2,
      allowProductivity: false,
      pool: [speed, eff],
      baseCount: 2.8,
      baseSpeedMult: 1,
    });
    expect(noBeacons).toEqual(["speed-1", "speed-1"]);
    // the same row beaconed to ×2 speed solved to 0.9 buildings — speed can't
    // shave anything below 1, so every slot cuts power instead
    const beaconed = pickAutoModules({
      slots: 2,
      allowProductivity: false,
      pool: [speed, eff],
      baseCount: 0.9,
      baseSpeedMult: 2,
    });
    expect(beaconed).toEqual(["eff-1", "eff-1"]);
  });

  it("falls back to speed→efficiency when prod is allowed but no prod module exists", () => {
    const fill = pickAutoModules({
      slots: 2,
      allowProductivity: true,
      pool: [speed, eff],
      baseCount: 0.5,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["eff-1", "eff-1"]);
  });

  it("leaves slots empty past the floor when there is no efficiency module", () => {
    const fill = pickAutoModules({
      slots: 4,
      allowProductivity: false,
      pool: [mod("speed-3", { effSpeed: 0.5, effConsumption: 0.7 })],
      baseCount: 1.92,
      baseSpeedMult: 1,
    });
    expect(fill).toEqual(["speed-3", "speed-3"]);
  });

  it("returns nothing for an empty pool or zero slots", () => {
    expect(
      pickAutoModules({
        slots: 0,
        allowProductivity: false,
        pool: [speed],
        baseCount: 3,
        baseSpeedMult: 1,
      }),
    ).toEqual([]);
    expect(
      pickAutoModules({
        slots: 2,
        allowProductivity: false,
        pool: [],
        baseCount: 3,
        baseSpeedMult: 1,
      }),
    ).toEqual([]);
  });
});
