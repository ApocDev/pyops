import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { chooseModuleFill } from "./module-fill.server.ts";

// module-fill dynamically imports ../db/queries.ts; mock it so the test stays
// pure (no db, no Factorio dump). We only need modulePickerData + availableModuleItems.
vi.mock("../db/queries.server.ts", () => ({
  modulePickerData: vi.fn(),
  availableModuleItems: vi.fn(),
}));
const { modulePickerData, availableModuleItems } = await import("../db/queries.server.ts");
const mockPicker = vi.mocked(modulePickerData);
const mockAvail = vi.mocked(availableModuleItems);

type Rows = Parameters<typeof chooseModuleFill>[0];
const mod = (
  name: string,
  eff: Partial<{ effSpeed: number; effProductivity: number; effConsumption: number }>,
) => ({
  name,
  effSpeed: 0,
  effProductivity: 0,
  effConsumption: 0,
  ...eff,
});
const row = (
  recipe: string,
  machine: { name: string; moduleSlots: number; count: number } | null,
  speed = 0,
) => ({ recipe, machine, effects: { speed } }) as unknown as Rows[number];

beforeEach(() => {
  mockPicker.mockReset();
  mockAvail.mockReset();
  // by default every requested module is available
  mockAvail.mockImplementation((names: string[]) => new Set(names));
});

describe("chooseModuleFill", () => {
  it("fills every slot with the best productivity module when allowed", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: true,
      modules: [
        mod("prod-1", { effProductivity: 0.04, effSpeed: -0.05 }),
        mod("prod-2", { effProductivity: 0.1, effSpeed: -0.15 }),
      ],
    } as unknown as ReturnType<typeof modulePickerData>);

    const out = await chooseModuleFill([
      row("smelt", { name: "furnace", moduleSlots: 2, count: 5 }),
    ]);
    expect(out.modules.smelt).toEqual(["prod-2", "prod-2"]); // best prod, all slots
    expect(out.machines.smelt).toBe("furnace"); // machine pinned
  });

  it("uses speed up to the whole-building floor, then fills the rest with efficiency", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: false,
      modules: [
        mod("speed-1", { effSpeed: 0.5, effConsumption: 0.5 }),
        mod("eff-1", { effConsumption: -0.3 }),
      ],
    } as unknown as ReturnType<typeof modulePickerData>);

    // 4 slots, base count 10, speed +0.5 each:
    //   count(3) = 10/(1+1.5) = 4 → floor 4; count(2)=5 > 4, so k = 3 speed + 1 eff
    const out = await chooseModuleFill([
      row("assemble", { name: "assembler", moduleSlots: 4, count: 10 }),
    ]);
    expect(out.modules.assemble).toEqual(["speed-1", "speed-1", "speed-1", "eff-1"]);
  });

  it("fills with efficiency when no speed module exists and prod isn't allowed", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: false,
      modules: [mod("eff-1", { effConsumption: -0.3 })],
    } as unknown as ReturnType<typeof modulePickerData>);

    const out = await chooseModuleFill([row("mix", { name: "mixer", moduleSlots: 2, count: 3 })]);
    expect(out.modules.mix).toEqual(["eff-1", "eff-1"]);
  });

  it("skips machines with no module slots", async () => {
    const out = await chooseModuleFill([row("hand", { name: "burner", moduleSlots: 0, count: 4 })]);
    expect(out.modules).toEqual({});
    expect(out.machines).toEqual({});
    expect(mockPicker).not.toHaveBeenCalled();
  });

  it("skips a recipe when none of its modules are available in the horizon", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: true,
      modules: [mod("prod-9", { effProductivity: 0.2 })],
    } as unknown as ReturnType<typeof modulePickerData>);
    mockAvail.mockReturnValue(new Set()); // nothing unlocked

    const out = await chooseModuleFill([
      row("smelt", { name: "furnace", moduleSlots: 2, count: 5 }),
    ]);
    expect(out.modules).toEqual({});
    expect(out.machines).toEqual({});
  });

  it("a count already under 1 building gets NO speed — all slots efficiency", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: false,
      modules: [
        mod("speed-1", { effSpeed: 0.5, effConsumption: 0.7 }),
        mod("eff-1", { effConsumption: -0.3 }),
      ],
    } as unknown as ReturnType<typeof modulePickerData>);

    // 0.8 buildings: it's 1 machine with or without speed — speed is pure waste
    const out = await chooseModuleFill([row("mix", { name: "mixer", moduleSlots: 4, count: 0.8 })]);
    expect(out.modules.mix).toEqual(["eff-1", "eff-1", "eff-1", "eff-1"]);
  });

  it("speed too weak to shave a whole building gets NO speed — all efficiency", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: false,
      modules: [
        // +10% each: 1.92 → 1.75 → 1.6 → 1.48 → 1.37 — ceil stays 2 at every k
        mod("speed-1", { effSpeed: 0.1, effConsumption: 0.7 }),
        mod("eff-1", { effConsumption: -0.3 }),
      ],
    } as unknown as ReturnType<typeof modulePickerData>);

    const out = await chooseModuleFill([
      row("press", { name: "press", moduleSlots: 4, count: 1.92 }),
    ]);
    expect(out.modules.press).toEqual(["eff-1", "eff-1", "eff-1", "eff-1"]);
  });

  it("strong speed that DOES shave a building is used minimally, rest efficiency", async () => {
    mockPicker.mockReturnValue({
      allowProductivity: false,
      modules: [
        // +50% each: 1.92 → 1.28 → 0.96 (ceil 1 at k=2) → 2 speed + 2 eff
        mod("speed-1", { effSpeed: 0.5, effConsumption: 0.7 }),
        mod("eff-1", { effConsumption: -0.3 }),
      ],
    } as unknown as ReturnType<typeof modulePickerData>);

    const out = await chooseModuleFill([
      row("press", { name: "press", moduleSlots: 4, count: 1.92 }),
    ]);
    expect(out.modules.press).toEqual(["speed-1", "speed-1", "eff-1", "eff-1"]);
  });
});
