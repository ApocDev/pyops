import { describe, expect, it } from "vite-plus/test";
import { type BlockWithFlows, factoryWhatIf } from "./factory-solve.ts";

// A minimal 2-block factory: a "plates" block feeds a "gears" block.
//  - ore   : only consumed → raw
//  - plate : primary of plates, imported by gears → intermediate (balance)
//  - gear  : primary of gears, nobody consumes → demand (pin)
const plates: BlockWithFlows = {
  id: 1,
  name: "plates",
  rate: 1,
  flows: [
    { item: "plate", kind: "item", role: "primary", rate: 2 },
    { item: "ore", kind: "item", role: "import", rate: 8 },
  ],
};
const gears: BlockWithFlows = {
  id: 2,
  name: "gears",
  rate: 1,
  flows: [
    { item: "gear", kind: "item", role: "primary", rate: 1 },
    { item: "plate", kind: "item", role: "import", rate: 2 },
  ],
};

const byId = <T extends { id: number }>(rep: T[], id: number) => rep.find((b) => b.id === id)!;

describe("factoryWhatIf", () => {
  it("leaves a balanced factory at scale 1", async () => {
    const r = await factoryWhatIf([plates, gears]);
    expect(r.status).toBe("Optimal");
    expect(byId(r.blocks, 1).scale).toBeCloseTo(1);
    expect(byId(r.blocks, 2).scale).toBeCloseTo(1);
    // gear is the demand; ore is the raw input
    expect(r.demands.map((d) => d.good)).toEqual(["gear"]);
    expect(r.raws.map((d) => d.good)).toEqual(["ore"]);
    expect(r.demands.find((d) => d.good === "gear")).toMatchObject({
      good: "gear",
      current: 1,
      target: 1,
    });
  });

  it("scales the upstream block to satisfy an increased demand", async () => {
    // ask for 2 gears/s; gears must double, and plates must double to feed it.
    const r = await factoryWhatIf([plates, gears], { gear: 2 });
    expect(r.status).toBe("Optimal");
    expect(byId(r.blocks, 2).scale).toBeCloseTo(2); // gears
    expect(byId(r.blocks, 1).scale).toBeCloseTo(2); // plates feed them
    expect(byId(r.blocks, 2).requiredRate).toBeCloseTo(2);
    // raw ore demand scales with it: 8 × 2 = 16
    const ore = r.raws.find((g) => g.good === "ore")!;
    expect(ore.projected).toBeCloseTo(16);
    expect(r.demands.find((d) => d.good === "gear")!.target).toBeCloseTo(2);
  });

  it("can scale the downstream block down to a fractional demand", async () => {
    const r = await factoryWhatIf([plates, gears], { gear: 0.5 });
    expect(r.status).toBe("Optimal");
    expect(byId(r.blocks, 2).scale).toBeCloseTo(0.5);
    expect(byId(r.blocks, 1).scale).toBeCloseTo(0.5);
  });

  it("reports an overproduced byproduct as surplus to handle", async () => {
    // a smelting block emits 'slag' as a non-primary byproduct nobody consumes
    const smelter: BlockWithFlows = {
      id: 3,
      name: "smelter",
      rate: 1,
      flows: [
        { item: "plate", kind: "item", role: "primary", rate: 2 },
        { item: "slag", kind: "item", role: "export", rate: 1 },
        { item: "ore", kind: "item", role: "import", rate: 8 },
      ],
    };
    const r = await factoryWhatIf([smelter, gears], { gear: 2 });
    expect(r.status).toBe("Optimal");
    const slag = r.overproduced.find((g) => g.good === "slag");
    expect(slag).toBeTruthy();
    expect(slag!.cls).toBe("surplus");
    expect(slag!.projected).toBeGreaterThan(0);
  });
});
