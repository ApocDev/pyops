// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ItemChip } from "./item-chip.tsx";

afterEach(cleanup);

vi.mock("#/server/factorio", () => ({
  itemDetailFn: () => Promise.resolve(null),
}));

describe("ItemChip spoil time", () => {
  it("shows the product's spoil time and includes it in the accessible label", () => {
    const { getByRole, getByText } = render(
      <ItemChip
        name="petri-dish-bacteria"
        kind="item"
        display="Incubated petri dish"
        rate={0.6}
        spoilTicks={2_700}
        link="linked"
        onClick={() => {}}
      />,
    );

    expect(getByText("45s").getAttribute("data-item-spoil-time")).not.toBeNull();
    expect(getByRole("button").getAttribute("aria-label")).toContain("spoils in 45s");
  });

  it("does not add spoilage text to ordinary item chips", () => {
    const { container } = render(
      <ItemChip
        name="iron-plate"
        kind="item"
        display="Iron plate"
        rate={1}
        link="linked"
        onClick={() => {}}
      />,
    );

    expect(container.querySelector("[data-item-spoil-time]")).toBeNull();
  });
});
