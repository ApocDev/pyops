import { describe, expect, it } from "vite-plus/test";
import { type BlockWithFlows, factoryWhatIf } from "./factory-solve.server.ts";

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

  // ── fluid-fuel matching (#115): pyops-fluid-fuel left FREE_GOODS — generic MJ
  // imports now match designated MJ exports block-to-block like any other good.
  describe("fluid-fuel matching (#115)", () => {
    // an unfiltered fluid-burner block: generic MJ demand, no ceremony
    const glassworks: BlockWithFlows = {
      id: 4,
      name: "glassworks",
      rate: 20,
      flows: [
        { item: "molten-glass", kind: "fluid", role: "primary", rate: 20 },
        { item: "sand", kind: "item", role: "import", rate: 20 },
        { item: "pyops-fluid-fuel", kind: "fluid", role: "import", rate: 40 },
      ],
    };
    // a DESIGNATED supplier: pyops-fluid-fuel pinned as its goal (role primary)
    const fuelFarm: BlockWithFlows = {
      id: 5,
      name: "fuel farm",
      rate: 40,
      flows: [
        { item: "pyops-fluid-fuel", kind: "fluid", role: "primary", rate: 40 },
        { item: "crude", kind: "fluid", role: "import", rate: 53.3 },
      ],
    };
    // kerosene sold as chemical FEEDSTOCK — fuel-valued, but it exports the
    // fluid itself, not MJ; it must never be conscripted as fuel supply
    const keroseneFeedstock: BlockWithFlows = {
      id: 6,
      name: "kerosene feedstock",
      rate: 10,
      flows: [
        { item: "kerosene", kind: "fluid", role: "primary", rate: 10 },
        { item: "crude", kind: "fluid", role: "import", rate: 20 },
      ],
    };

    it("a designated MJ supplier balances a generic-importing block", async () => {
      const r = await factoryWhatIf([glassworks, fuelFarm]);
      expect(r.status).toBe("Optimal");
      // MJ is a matched intermediate now — neither a raw nor a pinned demand
      expect(r.raws.map((g) => g.good)).not.toContain("pyops-fluid-fuel");
      expect(r.demands.map((g) => g.good)).toEqual(["molten-glass"]);
      expect(byId(r.blocks, 4).scale).toBeCloseTo(1);
      expect(byId(r.blocks, 5).scale).toBeCloseTo(1);
    });

    it("scales the supplier with the consumer's demand", async () => {
      const r = await factoryWhatIf([glassworks, fuelFarm], { "molten-glass": 40 });
      expect(r.status).toBe("Optimal");
      expect(byId(r.blocks, 4).scale).toBeCloseTo(2); // glassworks doubles
      expect(byId(r.blocks, 5).scale).toBeCloseTo(2); // fuel farm follows the 80 MJ/s draw
      const crude = r.raws.find((g) => g.good === "crude")!;
      expect(crude.projected).toBeCloseTo(106.6);
    });

    it("a kerosene-as-feedstock exporter does NOT count as fuel supply", async () => {
      const r = await factoryWhatIf([glassworks, keroseneFeedstock], { "molten-glass": 40 });
      expect(r.status).toBe("Optimal");
      // nothing exports MJ → it classifies as an external input (the signal to
      // designate a supplier), and the kerosene block is never scaled to feed it
      const mj = r.raws.find((g) => g.good === "pyops-fluid-fuel")!;
      expect(mj.projected).toBeCloseTo(80);
      expect(byId(r.blocks, 6).scale).toBeCloseTo(1);
    });

    it("electricity (and heat) stay free — a grid producer is never matched", async () => {
      const consumer: BlockWithFlows = {
        id: 7,
        name: "smelter",
        rate: 1,
        flows: [
          { item: "plate", kind: "item", role: "primary", rate: 2 },
          { item: "ore", kind: "item", role: "import", rate: 8 },
          { item: "pyops-electricity", kind: "fluid", role: "import", rate: 50 },
        ],
      };
      const powerPlant: BlockWithFlows = {
        id: 8,
        name: "power",
        rate: 100,
        flows: [{ item: "pyops-electricity", kind: "fluid", role: "primary", rate: 100 }],
      };
      const r = await factoryWhatIf([consumer, powerPlant], { plate: 4 });
      expect(r.status).toBe("Optimal");
      expect(byId(r.blocks, 7).scale).toBeCloseTo(2);
      // grid utility: still a free boundary, so the power block is pinned at 1
      // even though the electric draw doubled (pyops-heat shares the same set)
      expect(byId(r.blocks, 8).scale).toBeCloseTo(1);
      expect(r.raws.map((g) => g.good)).toContain("pyops-electricity");
    });
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

  it("never scales a source block to satisfy demand for its incidental byproduct", async () => {
    const agarScience: BlockWithFlows = {
      id: 20,
      name: "Agar science",
      rate: 1,
      flows: [
        { item: "science", kind: "item", role: "primary", rate: 1 },
        { item: "biocrud", kind: "item", role: "byproduct", rate: 0.1 },
        { item: "ore", kind: "item", role: "import", rate: 4 },
      ],
    };
    const biocrudSink: BlockWithFlows = {
      id: 21,
      name: "Biocrud sink",
      rate: -5,
      flows: [{ item: "biocrud", kind: "item", role: "import", rate: 5 }],
    };

    const current = await factoryWhatIf([agarScience, biocrudSink]);
    expect(byId(current.blocks, agarScience.id).scale).toBeCloseTo(1);
    expect(byId(current.blocks, biocrudSink.id).scale).toBeCloseTo(1);

    const doubledScience = await factoryWhatIf([agarScience, biocrudSink], { science: 2 });
    expect(byId(doubledScience.blocks, agarScience.id).scale).toBeCloseTo(2);
    expect(byId(doubledScience.blocks, biocrudSink.id).scale).toBeCloseTo(1);
  });
});
