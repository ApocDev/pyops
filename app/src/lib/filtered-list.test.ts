import { describe, expect, it } from "vite-plus/test";
import { filterList } from "./filtered-list";

type Good = { name: string; display: string | null };
const goods: Good[] = [
  { name: "iron-plate", display: "Iron plate" },
  { name: "iron-stick", display: "Iron stick" },
  { name: "electronic-circuit", display: "Electronic circuit" },
  { name: "iron-pulp-07", display: "Chopped iron wood pulp" },
  { name: "no-display", display: null },
];
const keys = {
  display: (g: Good) => g.display,
  internal: (g: Good) => g.name,
};

describe("filterList", () => {
  it("returns the list untouched for an empty/whitespace query", () => {
    expect(filterList(goods, "", keys)).toEqual(goods);
    expect(filterList(goods, "   ", keys)).toEqual(goods);
  });

  it("matches display names case-insensitively", () => {
    expect(filterList(goods, "IRON PLATE", keys).map((g) => g.name)).toEqual(["iron-plate"]);
  });

  it("drops items matching neither display nor internal name", () => {
    expect(filterList(goods, "zzz-nothing", keys)).toEqual([]);
  });

  it("ranks prefix matches above substring matches", () => {
    const out = filterList(goods, "iron", keys).map((g) => g.name);
    // "Iron plate"/"Iron stick" start with the query; "Chopped iron wood pulp"
    // only contains it — prefix matches come first, input order breaks the tie.
    expect(out).toEqual(["iron-plate", "iron-stick", "iron-pulp-07"]);
  });

  it("falls back to internal names when no display matches, ranked below display hits", () => {
    // "pulp" hits "Chopped iron wood pulp" (display) AND iron-pulp-07's internal
    // name; "07" hits only the internal name.
    expect(filterList(goods, "07", keys).map((g) => g.name)).toEqual(["iron-pulp-07"]);
    const mixed = filterList(
      [
        { name: "a-pulp-recipe", display: "Unrelated" }, // internal-only hit
        { name: "b", display: "Wood pulp" }, // display hit, later in input order
      ],
      "pulp",
      keys,
    );
    expect(mixed.map((g) => g.name)).toEqual(["b", "a-pulp-recipe"]);
  });

  it("skips internal matching entirely when no internal key is given", () => {
    expect(filterList(goods, "07", { display: (g) => g.display })).toEqual([]);
  });

  it("handles null displays and multiple display candidates", () => {
    // no-display has display:null — must not crash, and can still match via internal
    expect(filterList(goods, "no-disp", keys).map((g) => g.name)).toEqual(["no-display"]);
    const masters = [
      { display: "Master A", subs: ["Branch one", "Branch two"] },
      { display: "Master B", subs: ["Other branch"] },
    ];
    const out = filterList(masters, "two", {
      display: (m) => [m.display, ...m.subs],
    });
    expect(out.map((m) => m.display)).toEqual(["Master A"]);
  });

  it("matches internal names separator-insensitively, like the server-side searchAll", () => {
    const out = filterList([{ name: "iron-pulp-07", display: "Unrelated" }], "iron pulp 07", keys);
    expect(out.map((g) => g.name)).toEqual(["iron-pulp-07"]);
  });

  it("matches palette-style subsequences, ranked below substrings", () => {
    // "ironpu" is not a substring of anything, but is an in-order subsequence
    // of "Chopped iron wood pulp" — the palette's forgiving tier applies here too.
    expect(filterList(goods, "ironpu", keys).map((g) => g.name)).toEqual(["iron-pulp-07"]);
  });
});
