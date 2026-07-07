// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IconProvider } from "./icons.tsx";
import { RecipeCard, TechLine } from "./recipe-card.tsx";

afterEach(cleanup); // vite-plus/test doesn't auto-wire RTL cleanup

// recipe-card and icons both pull from ../server/factorio; stub the data fns so
// no server/db is touched. Icon manifest resolves empty (we assert text, not pixels).
const { recipeDetail } = vi.hoisted(() => ({
  recipeDetail: vi.fn(),
}));
vi.mock("../server/factorio", () => ({
  iconManifestFn: () => Promise.resolve({ cell: 64, atlasSize: 4096, sheets: [], icons: {} }),
  spoilablesFn: () => Promise.resolve({}),
  recipeDetailFn: recipeDetail,
  techDetailFn: () => Promise.resolve(null),
  itemDetailFn: () => Promise.resolve(null),
}));

function withProviders(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IconProvider>{ui}</IconProvider>
    </QueryClientProvider>,
  );
}

describe("TechLine", () => {
  const unlock = {
    tech: "automation-2",
    display: "Automation 2",
    science: [{ name: "automation-science-pack", amount: 10 }],
  };

  it("shows the localized display name, not the internal id", () => {
    const { getByText, queryByText } = withProviders(<TechLine unlock={unlock} />);
    expect(getByText("Automation 2")).toBeTruthy();
    // the internal id is never the visible label
    expect(queryByText("automation-2")).toBeNull();
  });

  it("falls back to the internal id only when no display exists", () => {
    const { getByText } = withProviders(
      <TechLine unlock={{ tech: "mystery-tech", display: null, science: [] }} />,
    );
    expect(getByText("mystery-tech")).toBeTruthy();
  });

  it("styles + tooltips differently for required vs researched", async () => {
    // scope each render to its own container (both mount into the same body);
    // the availability note now lives in the Tooltip, shown on focus.
    const req = withProviders(<TechLine unlock={unlock} />);
    const reqSpan = within(req.container).getByText("Automation 2").parentElement!;
    expect(reqSpan.className).toContain("text-destructive/90");
    fireEvent.focus(reqSpan);
    expect((await req.findByRole("tooltip")).textContent).toContain("requires research:");

    const done = withProviders(<TechLine unlock={unlock} researched />);
    const doneSpan = within(done.container).getByText("Automation 2").parentElement!;
    expect(doneSpan.className).toContain("text-success");
    fireEvent.focus(doneSpan);
    // req's tooltip may still be open, so match across all shown tooltips
    const tips = await done.findAllByRole("tooltip");
    expect(tips.some((t) => t.textContent?.includes("researched:"))).toBe(true);
  });
});

describe("RecipeCard", () => {
  beforeEach(() => recipeDetail.mockReset());

  it("renders the recipe's display name as the heading with the internal id as subtext", async () => {
    recipeDetail.mockResolvedValue({
      recipe: {
        display: "Iron Plate",
        kind: "real",
        category: "smelting",
        energyRequired: 3.2,
        allowProductivity: true,
        enabled: true,
        ingredients: [{ kind: "item", name: "iron-ore", display: "Iron Ore", amount: 1 }],
        products: [{ kind: "item", name: "iron-plate", display: "Iron Plate", amount: 1 }],
      },
      machines: [],
      unlocks: [],
    });

    const { getByText, findByText } = withProviders(<RecipeCard name="iron-plate" />);
    // heading shows the display name…
    expect(await findByText("Iron Plate")).toBeTruthy();
    // …and the raw id is shown as the muted secondary line (allowed: identity ref)
    expect(getByText("iron-plate")).toBeTruthy();
    // ingredient line uses the localized name too
    expect(getByText(/Iron Ore/)).toBeTruthy();
  });

  it("falls back to the internal id before the detail query resolves", () => {
    recipeDetail.mockResolvedValue({ recipe: undefined, machines: [], unlocks: [] });
    const { getAllByText } = withProviders(<RecipeCard name="copper-cable" />);
    // heading + muted subline both render the id when no display is available yet
    expect(getAllByText("copper-cable").length).toBeGreaterThan(0);
  });
});
