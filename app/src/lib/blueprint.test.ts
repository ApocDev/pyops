import { describe, expect, it } from "vite-plus/test";
import { constantCombinatorBlueprint, decodeBlueprint, encodeBlueprint } from "./blueprint";

type Bp = {
  blueprint: {
    item: string;
    label: string;
    icons?: { signal: { type: string; name: string }; index: number }[];
    entities: {
      name: string;
      control_behavior: {
        sections: {
          sections: {
            index: number;
            active?: boolean;
            filters: {
              index: number;
              name: string;
              quality: string;
              comparator: string;
              count: number;
            }[];
          }[];
        };
      };
    }[];
    version: number;
  };
};

describe("constant-combinator blueprint", () => {
  const bp = constantCombinatorBlueprint("Sushi: Test", [
    {
      active: true,
      signals: [
        { name: "iron-ore", type: "item", count: -320 },
        { name: "moss", type: "item", count: -2 },
      ],
    },
    { active: false, signals: [{ name: "iron-plate", type: "item", count: -40 }] },
    { active: false, signals: [] }, // empty roles are dropped, not emitted
  ]) as Bp;
  const sections = bp.blueprint.entities[0].control_behavior.sections.sections;

  it("carries every signal with quality=normal and the signed count", () => {
    expect(sections[0].filters).toHaveLength(2);
    expect(sections[0].filters[0]).toMatchObject({
      index: 1,
      name: "iron-ore",
      quality: "normal",
      comparator: "=",
      count: -320,
    });
    expect(sections[0].filters[1].count).toBe(-2);
  });

  it("splits sections per role, disabled ones marked inactive, empty ones dropped", () => {
    expect(sections).toHaveLength(2);
    expect(sections[0].active).toBeUndefined(); // active sections carry no flag
    expect(sections[1]).toMatchObject({ index: 2, active: false });
    expect(sections[1].filters[0].name).toBe("iron-plate");
  });

  it("labels the print and uses the first signal as its icon", () => {
    expect(bp.blueprint.label).toBe("Sushi: Test");
    expect(bp.blueprint.icons?.[0].signal.name).toBe("iron-ore");
    expect(bp.blueprint.version).toBe(562949957812224);
  });

  it("encodes to a v0 string that round-trips", async () => {
    const str = await encodeBlueprint(bp);
    expect(str.startsWith("0")).toBe(true);
    expect(await decodeBlueprint(str)).toEqual(bp);
  });
});
