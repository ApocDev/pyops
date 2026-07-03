// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ConfirmDialog } from "./confirm-dialog.tsx";

afterEach(cleanup);

describe("ConfirmDialog", () => {
  const props = {
    title: "Delete block",
    description: 'Delete "Iron plates"? This destroys its 3 recipes and 1 goal.',
    confirmLabel: "Delete block",
  };

  it("renders nothing when closed", () => {
    render(<ConfirmDialog {...props} open={false} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the title, body copy, and both actions when open", () => {
    render(<ConfirmDialog {...props} open onOpenChange={() => {}} onConfirm={() => {}} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete block");
    expect(dialog.textContent).toContain('Delete "Iron plates"?');
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete block" })).toBeTruthy();
  });

  it("runs onConfirm from the destructive action, not from Cancel", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...props} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete block" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
