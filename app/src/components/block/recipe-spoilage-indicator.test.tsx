// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { RecipeSpoilageIndicator } from "./recipe-spoilage-indicator.tsx";

afterEach(cleanup);

describe("RecipeSpoilageIndicator", () => {
  it("shows a spoil time for a recipe with one spoilable item product", () => {
    const { getByLabelText } = render(
      <RecipeSpoilageIndicator
        products={[{ name: "petri-dish-bacteria", kind: "item", display: "Incubated petri dish" }]}
        spoilables={{ "petri-dish-bacteria": 2_700 }}
      />,
    );

    const indicator = getByLabelText("Produces Incubated petri dish, which spoils in 45s");
    expect(indicator.textContent).toContain("45s");
  });

  it("summarizes every spoilable output of a multi-product recipe", () => {
    const { getByRole } = render(
      <RecipeSpoilageIndicator
        products={[
          { name: "agar", kind: "item", display: "Agar" },
          { name: "cellulose", kind: "item", display: "Cellulose" },
          { name: "steam", kind: "fluid", display: "Steam" },
        ]}
        spoilables={{ agar: 18_000, cellulose: 36_000, steam: 60 }}
      />,
    );

    const indicator = getByRole("img");
    expect(indicator.getAttribute("aria-label")).toBe(
      "Spoilable products:\nAgar — 5m\nCellulose — 10m",
    );
    expect(indicator.textContent).toContain("2 spoil");
  });

  it("renders nothing when none of the recipe products spoil", () => {
    const { container } = render(
      <RecipeSpoilageIndicator
        products={[{ name: "iron-plate", kind: "item", display: "Iron plate" }]}
        spoilables={{ agar: 18_000 }}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
