// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BoardSearch, type SearchEntry } from "./board-search.tsx";

vi.mock("../../../lib/icons", () => ({ RawIcon: () => null }));
afterEach(cleanup);

const idOf = (el: HTMLElement) => (el.textContent?.includes("gear") ? 2 : 1);

const entries: SearchEntry[] = [
  { type: "block", id: 1, name: "Iron plate", iconKind: null, iconName: null },
  { type: "block", id: 2, name: "Iron gear", iconKind: null, iconName: null },
];

describe("BoardSearch", () => {
  it("Enter on a focused result picks that result once, not the highlighted one", () => {
    const onPick = vi.fn();
    render(<BoardSearch entries={entries} onPick={onPick} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "iron" } });
    const second = screen.getAllByRole("option")[1]!;
    second.focus();
    fireEvent.keyDown(second, { key: "Enter" });
    fireEvent.click(second); // the browser's native Enter activation
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ kind: "block", id: idOf(second) });
  });

  it("Enter in the input picks the highlighted result", () => {
    const onPick = vi.fn();
    render(<BoardSearch entries={entries} onPick={onPick} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "iron" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const highlighted = screen.getAllByRole("option")[1]!;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ kind: "block", id: idOf(highlighted) });
  });
});
