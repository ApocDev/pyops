import { describe, expect, it } from "vite-plus/test";
import { currentFills, suggestionInputs } from "./module-suggestions.ts";

const rows = [
  { recipe: "a", rate: 1, machine: "assembler-mk01" },
  { recipe: "b", rate: 2, machine: "assembler-mk01" },
  { recipe: "c", rate: 3, machine: "assembler-mk01" },
];
const doc = { modules: { c: ["speed-module"] } };
const held = {
  inputs: suggestionInputs(doc, rows),
  fills: {
    a: ["prod-module", "prod-module"],
    b: ["prod-module", "prod-module"],
    c: ["prod-module"],
  },
};

describe("currentFills", () => {
  it("drops a held fill for a row whose machine changed and keeps the rest", () => {
    const next = rows.map((r) => (r.recipe === "b" ? { ...r, machine: "assembler-mk02" } : r));
    const fills = currentFills(held, suggestionInputs(doc, next));
    expect(fills.b).toBeUndefined();
    // unchanged rows keep the same array, so their memoized rows don't re-render
    expect(fills.a).toBe(held.fills.a);
    expect(fills.c).toBe(held.fills.c);
  });

  it("drops a held fill when the row's own module or beacon picks change", () => {
    const modules = currentFills(held, suggestionInputs({ modules: { c: [] } }, rows));
    expect(modules.c).toBeUndefined();
    const beacons = currentFills(
      held,
      suggestionInputs(
        { ...doc, beacons: { a: [{ beacon: "beacon", count: 2, modules: [] }] } },
        rows,
      ),
    );
    expect(beacons.a).toBeUndefined();
    expect(beacons.b).toBe(held.fills.b);
  });

  it("drops a held fill when the row's rate changed", () => {
    const next = rows.map((r) => (r.recipe === "a" ? { ...r, rate: 5 } : r));
    expect(currentFills(held, suggestionInputs(doc, next)).a).toBeUndefined();
  });
});
