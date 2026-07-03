import { describe, expect, it } from "vite-plus/test";
import { explorerGroup, groupExplorerCards, type ExplorerCard } from "./explorer";

const card = (over: Partial<ExplorerCard> & { name: string }): ExplorerCard => ({
  display: over.name,
  enabled: true,
  unlocks: [],
  avail: { research: "enabled", turd: null },
  superseded: null,
  flow: null,
  cost: null,
  ...over,
});

describe("explorerGroup", () => {
  it("puts start-enabled and researched recipes in 'now'", () => {
    expect(explorerGroup(card({ name: "a" }))).toBe("now");
    expect(
      explorerGroup(
        card({
          name: "b",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: null },
        }),
      ),
    ).toBe("now");
    // an ACTIVE TURD choice grants the recipe — it's available now
    expect(
      explorerGroup(
        card({
          name: "c",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: { state: "active" } },
        }),
      ),
    ).toBe("now");
  });

  it("splits unpicked TURD choices from plain research locks", () => {
    expect(
      explorerGroup(
        card({
          name: "a",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: { state: "pickable" } },
        }),
      ),
    ).toBe("turd");
    expect(
      explorerGroup(
        card({
          name: "b",
          enabled: false,
          unlocks: [{}],
          avail: { research: "needs-research", turd: null },
        }),
      ),
    ).toBe("research");
    // beyond the horizon wins over a pending TURD pick — research comes first
    expect(
      explorerGroup(
        card({
          name: "c",
          enabled: false,
          unlocks: [{}],
          avail: { research: "needs-research", turd: { state: "pickable" } },
        }),
      ),
    ).toBe("research");
  });

  it("marks superseded, TURD-blocked, and never-unlocked recipes 'off'", () => {
    expect(explorerGroup(card({ name: "a", superseded: { newRecipe: "x" } }))).toBe("off");
    expect(
      explorerGroup(
        card({
          name: "b",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: { state: "blocked" } },
        }),
      ),
    ).toBe("off");
    expect(
      explorerGroup(
        card({
          name: "c",
          enabled: false,
          unlocks: [],
          avail: { research: "needs-research", turd: null },
        }),
      ),
    ).toBe("off");
  });
});

describe("groupExplorerCards", () => {
  it("orders groups now → turd → research → off and drops empty ones", () => {
    const groups = groupExplorerCards([
      card({
        name: "later",
        enabled: false,
        unlocks: [{}],
        avail: { research: "needs-research", turd: null },
      }),
      card({ name: "ready" }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["now", "research"]);
    expect(groups[0].cards.map((c) => c.name)).toEqual(["ready"]);
  });

  it("ranks by flow desc inside a group, then cost asc, then name", () => {
    const groups = groupExplorerCards([
      card({ name: "slack", flow: 0, cost: 1 }),
      card({ name: "hot", flow: 5, cost: 100 }),
      card({ name: "warm", flow: 2, cost: 3 }),
      card({ name: "b-cheap", flow: 0, cost: 1 }),
      card({ name: "pricey", flow: 0, cost: 9 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.name)).toEqual([
      "hot",
      "warm",
      "b-cheap",
      "slack",
      "pricey",
    ]);
  });

  it("sorts unpriced recipes (null flow) below zero-flow ones", () => {
    const groups = groupExplorerCards([
      card({ name: "unpriced", flow: null }),
      card({ name: "zero", flow: 0 }),
    ]);
    expect(groups[0].cards.map((c) => c.name)).toEqual(["zero", "unpriced"]);
  });
});
