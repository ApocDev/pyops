// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ItemChip } from "./item-chip.tsx";
import { IncidentalSpoilageChip } from "./incidental-spoilage-chip.tsx";

afterEach(cleanup);

vi.mock("#/server/factorio", () => ({
  itemDetailFn: () => Promise.resolve(null),
}));

describe("ItemChip spoil time", () => {
  it("shows average, minimum, and maximum for variable power generation", () => {
    const { getByRole, getByText } = render(
      <ItemChip
        name="pyops-electricity"
        kind="fluid"
        display="Electricity (MJ)"
        rate={48}
        rateMin={16}
        rateMax={80}
        link="target"
        onClick={() => {}}
      />,
    );

    expect(getByText("48 MW avg · 16 MW–80 MW").getAttribute("data-rate-range")).toBe("variable");
    expect(getByRole("button").getAttribute("aria-label")).toContain("48 MW avg · 16 MW–80 MW");
  });

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

  it("labels an incidental-spoil export without adding another rate", () => {
    const { container, getByRole } = render(
      <ItemChip
        name="biocrud"
        kind="item"
        display="Biocrud"
        rate={0.01}
        incidental
        link="export"
        onClick={() => {}}
      />,
    );

    expect(container.querySelector("[data-incidental-spoilage]")).not.toBeNull();
    expect(getByRole("button").getAttribute("aria-label")).toContain(
      "includes estimated incidental spoilage",
    );
    expect(getByRole("button").textContent).toBe("0.01· Incidental");
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

describe("IncidentalSpoilageChip", () => {
  it("shows the derived result beside an arrow and edits the source estimate", () => {
    const onEdit = vi.fn();
    const { getByRole } = render(
      <IncidentalSpoilageChip
        result="biocrud"
        resultDisplay="Biocrud"
        rate={0.01}
        onEdit={onEdit}
      />,
    );

    const chip = getByRole("button");
    expect(chip.getAttribute("aria-label")).toContain("Biocrud 0.01/s");
    expect(chip.textContent).toBe("0.01· Incidental");
    fireEvent.click(chip);
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
