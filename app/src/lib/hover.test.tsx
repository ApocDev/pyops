// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CursorHover } from "./hover";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderChip = (onClick = () => {}, onContextMenu?: () => void) =>
  render(
    <CursorHover card={<div>Iron ore card</div>}>
      <button
        onClick={onClick}
        data-context-menu={onContextMenu ? "" : undefined}
        onContextMenu={onContextMenu}
      >
        Iron ore
      </button>
    </CursorHover>,
  );

describe("CursorHover keyboard and touch", () => {
  it("opens on keyboard focus after a short delay and closes on Escape", () => {
    const { getByRole, queryByText } = renderChip();
    const chip = getByRole("button");
    // jsdom has no keyboard-modality heuristic; treat this focus as keyboard focus.
    const matches = vi.spyOn(chip, "matches").mockReturnValue(true);

    act(() => chip.focus());
    expect(queryByText("Iron ore card")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(queryByText("Iron ore card")).not.toBeNull();

    // the mouse passing over and off the chip doesn't close a focus-opened card
    fireEvent.mouseEnter(chip);
    fireEvent.mouseLeave(chip);
    expect(queryByText("Iron ore card")).not.toBeNull();

    fireEvent.keyDown(chip, { key: "Escape" });
    expect(queryByText("Iron ore card")).toBeNull();
    matches.mockRestore();
  });

  it("does not open on mouse-click focus", () => {
    const { getByRole, queryByText } = renderChip();
    const chip = getByRole("button");
    vi.spyOn(chip, "matches").mockReturnValue(false);
    act(() => chip.focus());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(queryByText("Iron ore card")).toBeNull();
  });

  it("opens on touch long-press without firing the press's click or context menu", () => {
    const onClick = vi.fn();
    const { getByRole, queryByText } = renderChip(onClick);
    const chip = getByRole("button");

    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(queryByText("Iron ore card")).not.toBeNull();
    // a browser long-press contextmenu is swallowed (false = default prevented)
    expect(fireEvent.contextMenu(chip)).toBe(false);
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();

    // the next touch anywhere dismisses it; a plain tap still clicks
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(queryByText("Iron ore card")).toBeNull();
    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("leaves long-press to an element's own context menu", () => {
    const onClick = vi.fn();
    const onMenu = vi.fn();
    const { getByRole, queryByText } = renderChip(onClick, onMenu);
    const chip = getByRole("button");

    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(queryByText("Iron ore card")).toBeNull();
    // the browser's long-press contextmenu still reaches the chip's menu
    fireEvent.contextMenu(chip);
    expect(onMenu).toHaveBeenCalledOnce();
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
