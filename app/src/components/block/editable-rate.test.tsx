// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EditableRate } from "./editable-rate.tsx";

afterEach(cleanup);

describe("EditableRate", () => {
  it("commits a negative rate for a consume goal", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<EditableRate value={1} onChange={onChange} />);

    fireEvent.click(getByRole("button", { name: "1" }));
    const input = getByRole("textbox");
    fireEvent.change(input, { target: { value: "-2.5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(-2.5);
  });

  it("converts a negative display-window rate back to per-second", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<EditableRate value={1} unit="min" onChange={onChange} />);

    fireEvent.click(getByRole("button", { name: "60" }));
    const input = getByRole("textbox");
    fireEvent.change(input, { target: { value: "-150" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(-2.5);
  });
});
