import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  presetCompatibility,
  defaultPresetLoadout,
  type PickerLike,
} from "./module-presets.server.ts";

// db-backed helpers (defaultPresetLoadout) get a mocked query layer, like
// module-fill.test.ts; presetCompatibility itself is pure.
vi.mock("../db/queries.server.ts", () => ({
  listModulePresets: vi.fn(),
  modulePickerData: vi.fn(),
  moduleInfo: vi.fn(),
}));
const q = await import("../db/queries.server.ts");
const mockPresets = vi.mocked(q.listModulePresets);
const mockPicker = vi.mocked(q.modulePickerData);
const mockInfo = vi.mocked(q.moduleInfo);

/* Module facts straight from the Py dump (projects/py.db `modules`):
 *   speed-module          category speed         eff_speed 0.4
 *   productivity-module   category productivity  eff_productivity 0.1
 *   efficiency-module     category efficiency    eff_consumption -0.3
 *   auog                  category auog          eff_speed 1.0        */
const FACTS = new Map([
  ["speed-module", { display: "Speed module", effProductivity: 0 }],
  ["productivity-module", { display: "Productivity module", effProductivity: 0.1 }],
  ["efficiency-module", { display: "Efficiency module", effProductivity: 0 }],
  ["auog", { display: "Auog", effProductivity: 0 }],
]);

/** PickerLike mirroring what modulePickerData returns for a machine+recipe:
 * `modules`/`beacons[].modules` are the ALREADY-FILTERED accepted sets. */
const picker = (
  machine: { name: string; display: string; moduleSlots: number },
  accepted: string[],
  opts: { allowProductivity?: boolean; beacons?: PickerLike["beacons"] } = {},
): PickerLike => ({
  machine,
  allowProductivity: opts.allowProductivity ?? true,
  modules: accepted.map((name) => ({ name })),
  beacons: opts.beacons ?? [],
});

describe("presetCompatibility", () => {
  // pumpjack-mk01 (dump: module_slots 1, allowed_effects ["speed","consumption"]):
  // the picker accepts speed/efficiency but NOT productivity-module.
  const pumpjack = picker({ name: "pumpjack-mk01", display: "Pumpjack", moduleSlots: 1 }, [
    "speed-module",
    "efficiency-module",
  ]);

  it("accepts a loadout whose every module the picker accepts", () => {
    expect(
      presetCompatibility({ modules: ["speed-module"], beacons: [] }, pumpjack, FACTS),
    ).toEqual({ ok: true });
  });

  it("rejects a module outside the machine's allowed effects, naming it by display", () => {
    const res = presetCompatibility(
      { modules: ["productivity-module"], beacons: [] },
      pumpjack,
      FACTS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("Productivity module does not fit Pumpjack");
  });

  it("rejects on a category-locked machine (auog paddock only takes auog modules)", () => {
    // auog-paddock-mk01 (dump: 4 slots, allowed_module_categories ["auog"])
    const paddock = picker({ name: "auog-paddock-mk01", display: "Auog paddock", moduleSlots: 4 }, [
      "auog",
    ]);
    expect(presetCompatibility({ modules: ["auog"], beacons: [] }, paddock, FACTS)).toEqual({
      ok: true,
    });
    const res = presetCompatibility({ modules: ["speed-module"], beacons: [] }, paddock, FACTS);
    expect(res.ok).toBe(false);
  });

  it("calls out allow_productivity as the specific reason", () => {
    // tar-distilation (dump: allow_productivity 0) in a distilator (1 slot):
    // the picker's prodOk gate drops productivity-module from the accepted set.
    const distilator = picker(
      { name: "distilator", display: "Distilator", moduleSlots: 1 },
      ["speed-module", "efficiency-module"],
      { allowProductivity: false },
    );
    const res = presetCompatibility(
      { modules: ["productivity-module"], beacons: [] },
      distilator,
      FACTS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.reason).toBe("this recipe does not accept productivity (Productivity module)");
  });

  it("rejects machine modules when the machine has no slots (stone-furnace: 0 slots)", () => {
    const furnace = picker({ name: "stone-furnace", display: "Stone furnace", moduleSlots: 0 }, []);
    const res = presetCompatibility({ modules: ["speed-module"], beacons: [] }, furnace, FACTS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("Stone furnace has no module slots");
    // …but a beacon-only template can still apply to a slotless machine
    const beaconed = picker(
      { name: "stone-furnace", display: "Stone furnace", moduleSlots: 0 },
      [],
      {
        beacons: [{ name: "beacon-AM1-FM1", display: "Beacon AM1-FM1", modules: ["speed-module"] }],
      },
    );
    expect(
      presetCompatibility(
        {
          modules: [],
          beacons: [{ beacon: "beacon-AM1-FM1", modules: ["speed-module"], count: 1 }],
        },
        beaconed,
        FACTS,
      ),
    ).toEqual({ ok: true });
  });

  it("does NOT gate on slot count — extra modules truncate at apply time", () => {
    // a "speed everywhere" template saved from a 4-slot machine still fits 1 slot
    expect(
      presetCompatibility(
        { modules: ["speed-module", "speed-module", "speed-module", "speed-module"], beacons: [] },
        pumpjack,
        FACTS,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects beacon modules the beacon (or machine) does not accept", () => {
    // beacon-AM1-FM1 (dump: allowed_effects ["speed","consumption"]) never
    // transmits productivity, so the picker's per-beacon accepted set omits it.
    const p = picker(
      { name: "distilator", display: "Distilator", moduleSlots: 1 },
      ["speed-module", "productivity-module", "efficiency-module"],
      {
        beacons: [
          {
            name: "beacon-AM1-FM1",
            display: "Beacon AM1-FM1",
            modules: ["speed-module", "efficiency-module"],
          },
        ],
      },
    );
    const res = presetCompatibility(
      {
        modules: [],
        beacons: [{ beacon: "beacon-AM1-FM1", modules: ["productivity-module"], count: 1 }],
      },
      p,
      FACTS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.reason).toContain("Productivity module does not work in Beacon AM1-FM1");
  });

  it("rejects a beacon variant the picker does not offer", () => {
    const res = presetCompatibility(
      { modules: [], beacons: [{ beacon: "hidden-beacon", modules: [], count: 1 }] },
      pumpjack,
      FACTS,
    );
    expect(res.ok).toBe(false);
  });
});

describe("defaultPresetLoadout", () => {
  type Preset = ReturnType<typeof q.listModulePresets>[number];
  const preset = (p: Partial<Preset> & { name: string }): Preset =>
    ({
      id: 1,
      modules: [],
      beacons: [],
      icon: null,
      isDefault: false,
      createdAt: null,
      ...p,
    }) as Preset;

  beforeEach(() => {
    mockPresets.mockReset();
    mockPicker.mockReset();
    mockInfo.mockReset();
    mockInfo.mockImplementation((names: string[]) =>
      names.map((name) => ({
        name,
        display: FACTS.get(name)?.display ?? name,
        category: null,
        effSpeed: 0,
        effProductivity: FACTS.get(name)?.effProductivity ?? 0,
        effConsumption: 0,
      })),
    );
    // pumpjack-mk04-like row: 4 slots, prod not transmitted (dump allowed_effects
    // ["speed","consumption"]) — accepted set holds speed/efficiency only
    mockPicker.mockReturnValue({
      machine: { name: "pumpjack-mk04", display: "Pumpjack MK 04", moduleSlots: 4 },
      allowProductivity: true,
      modules: [{ name: "speed-module" }, { name: "efficiency-module" }],
      beacons: [],
    } as unknown as ReturnType<typeof q.modulePickerData>);
  });

  it("skips incompatible defaults and returns the first compatible one (name order)", () => {
    mockPresets.mockReturnValue([
      preset({ id: 1, name: "A prod", modules: ["productivity-module"], isDefault: true }),
      preset({
        id: 2,
        name: "B speed",
        modules: ["speed-module", "speed-module"],
        isDefault: true,
      }),
      preset({ id: 3, name: "C eff", modules: ["efficiency-module"], isDefault: true }),
    ]);
    expect(defaultPresetLoadout("crude-oil", "pumpjack-mk04")).toEqual({
      modules: ["speed-module", "speed-module"],
      beacons: [],
    });
  });

  it("ignores non-default presets entirely", () => {
    mockPresets.mockReturnValue([
      preset({ id: 1, name: "speed", modules: ["speed-module"], isDefault: false }),
    ]);
    expect(defaultPresetLoadout("crude-oil", "pumpjack-mk04")).toBeNull();
    expect(mockPicker).not.toHaveBeenCalled(); // no defaults → no db work
  });

  it("returns null when no default is compatible (auto-fill takes over)", () => {
    mockPresets.mockReturnValue([
      preset({ id: 1, name: "prod", modules: ["productivity-module"], isDefault: true }),
    ]);
    expect(defaultPresetLoadout("crude-oil", "pumpjack-mk04")).toBeNull();
  });

  it("truncates the loadout to the machine's slots", () => {
    mockPresets.mockReturnValue([
      preset({
        id: 1,
        name: "speed x6",
        modules: Array<string>(6).fill("speed-module"),
        isDefault: true,
      }),
    ]);
    expect(defaultPresetLoadout("crude-oil", "pumpjack-mk04")?.modules).toHaveLength(4);
  });
});
