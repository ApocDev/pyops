/**
 * rowTempWarnings — grouping the block's per-producer fluid-temperature
 * warnings (#110 interim) into per-chip tags for one recipe row. Uses the real
 * MHD/fusion values from py.db: dt-he3 makes neutron @3000°, b-h @4000°, the
 * MHD generators accept exactly 4000°/3000°.
 */
import { describe, expect, it } from "vite-plus/test";
import { rowTempWarnings } from "./temp-warnings.ts";

const DISPLAY = {
  "dt-he3": "Fuse deuterium and helium-3",
  "b-h": "Fuse boron with a proton",
  "generate-mdh-4000": "Magnetohydrodynamic (MHD) generator power (4000°)",
  neutron: "Neutron",
};

const WARNINGS = [
  {
    producer: "dt-he3",
    consumer: "generate-mdh-4000",
    item: "neutron",
    temp: 3000,
    needs: "4k°",
    partial: true,
  },
  {
    producer: "b-h",
    consumer: "generate-mdh-3000",
    item: "neutron",
    temp: 4000,
    needs: "3k°",
    partial: true,
  },
];

describe("rowTempWarnings", () => {
  it("tags the consumer row's ingredient chip with the offending temperature", () => {
    const { ingredient, product } = rowTempWarnings(WARNINGS, DISPLAY, "generate-mdh-4000");
    expect(product.size).toBe(0);
    const w = ingredient.get("neutron")!;
    expect(w.label).toBe("gets 3k°");
    expect(w.title).toContain("Fuse deuterium and helium-3");
    expect(w.title).toContain("Neutron");
    expect(w.title).toContain("3k°");
    expect(w.title).toContain("4k°");
  });

  it("tags the producer row's product chip with the range it can't feed", () => {
    const { ingredient, product } = rowTempWarnings(WARNINGS, DISPLAY, "dt-he3");
    expect(ingredient.size).toBe(0);
    const w = product.get("neutron")!;
    expect(w.label).toBe("needs 4k°");
    expect(w.title).toContain("Magnetohydrodynamic (MHD) generator power (4000°)");
    expect(w.title).toContain("3k°");
  });

  it("folds multiple counterparts into one tag per chip", () => {
    const both = [
      ...WARNINGS,
      {
        producer: "dt-he3",
        consumer: "another-consumer",
        item: "neutron",
        temp: 3000,
        needs: "≥3.5k°",
        partial: false,
      },
    ];
    const { product } = rowTempWarnings(both, DISPLAY, "dt-he3");
    const w = product.get("neutron")!;
    expect(w.label).toBe("needs 4k°, ≥3.5k°");
    expect(w.title.split("\n")).toHaveLength(2);
  });

  it("returns empty maps for an uninvolved recipe or no warnings", () => {
    const none = rowTempWarnings(WARNINGS, DISPLAY, "enriched-water");
    expect(none.ingredient.size).toBe(0);
    expect(none.product.size).toBe(0);
    const empty = rowTempWarnings(undefined, undefined, "dt-he3");
    expect(empty.ingredient.size).toBe(0);
    expect(empty.product.size).toBe(0);
  });
});
