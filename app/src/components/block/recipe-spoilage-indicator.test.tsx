// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { RecipeSpoilageIndicator } from "./recipe-spoilage-indicator.tsx";

afterEach(cleanup);

describe("RecipeSpoilageIndicator", () => {
  it("marks a recipe with one spoilable item product without repeating its time", () => {
    const { getByLabelText } = render(
      <RecipeSpoilageIndicator
        products={[{ name: "petri-dish-bacteria", kind: "item" }]}
        spoilables={{ "petri-dish-bacteria": 2_700 }}
      />,
    );

    const indicator = getByLabelText("has spoilable products");
    expect(indicator.textContent).toBe("");
    expect(indicator.getAttribute("data-state")).toBeNull();
  });

  it("still renders only one marker for many spoilable products", () => {
    const { getByLabelText } = render(
      <RecipeSpoilageIndicator
        products={[
          { name: "agar", kind: "item" },
          { name: "cellulose", kind: "item" },
          { name: "steam", kind: "fluid" },
        ]}
        spoilables={{ agar: 18_000, cellulose: 36_000, steam: 60 }}
      />,
    );

    const indicator = getByLabelText("has spoilable products");
    expect(indicator.querySelectorAll("svg")).toHaveLength(1);
  });

  it("renders nothing when none of the recipe products spoil", () => {
    const { container } = render(
      <RecipeSpoilageIndicator
        products={[{ name: "iron-plate", kind: "item" }]}
        spoilables={{ agar: 18_000 }}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
