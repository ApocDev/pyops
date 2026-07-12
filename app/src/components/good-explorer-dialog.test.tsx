// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { GoodExplorerDialog } from "./good-explorer-dialog";

vi.mock("./browse/good-detail.tsx", () => ({
  GoodDetail: ({ name }: { name?: string }) => <div>detail:{name}</div>,
}));

afterEach(cleanup);

test("Alt+Click opens the explorer and suppresses the trigger action", () => {
  const regularClick = vi.fn();
  render(
    <>
      <button onClick={regularClick}>
        <span data-good-kind="item" data-good-name="iron-plate">
          Iron plate
        </span>
      </button>
      <GoodExplorerDialog />
    </>,
  );

  fireEvent.click(screen.getByText("Iron plate"), { altKey: true });

  expect(regularClick).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Recipe explorer" })).toBeTruthy();
  expect(screen.getByText("detail:iron-plate")).toBeTruthy();
});

test("an ordinary click keeps the surface's existing behavior", () => {
  const regularClick = vi.fn();
  render(
    <>
      <button onClick={regularClick}>
        <span data-good-kind="fluid" data-good-name="water">
          Water
        </span>
      </button>
      <GoodExplorerDialog />
    </>,
  );

  fireEvent.click(screen.getByText("Water"));

  expect(regularClick).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "Recipe explorer" })).toBeNull();
});
