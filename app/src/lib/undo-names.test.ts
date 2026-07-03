import { describe, expect, it } from "vite-plus/test";

import { blockActionName, mergeActionLabel, undoToastMessage } from "./undo-names";

describe("mergeActionLabel", () => {
  it("starts from null", () => {
    expect(mergeActionLabel(null, null)).toBeNull();
  });

  it("takes the first label", () => {
    expect(mergeActionLabel(null, 'Add recipe "Auog paddock"')).toBe('Add recipe "Auog paddock"');
  });

  it("keeps the pending label through unlabeled edits", () => {
    expect(mergeActionLabel('Add recipe "Auog paddock"', null)).toBe('Add recipe "Auog paddock"');
  });

  it("keeps a repeated identical label", () => {
    expect(mergeActionLabel("Set rate", "Set rate")).toBe("Set rate");
  });

  it("falls back to null (generic save name) when two different labels collide", () => {
    expect(mergeActionLabel('Add recipe "A"', 'Remove recipe "B"')).toBeNull();
  });
});

describe("blockActionName", () => {
  it("suffixes the block name", () => {
    expect(blockActionName('Add recipe "Auog paddock"', "Auog")).toBe(
      'Add recipe "Auog paddock" — Auog',
    );
  });

  it("omits an empty/whitespace block name", () => {
    expect(blockActionName("Set rate", "  ")).toBe("Set rate");
  });

  it("returns undefined for a null label so the server default applies", () => {
    expect(blockActionName(null, "Auog")).toBeUndefined();
  });
});

describe("undoToastMessage", () => {
  it("names the reverted action", () => {
    expect(undoToastMessage('Delete block "Auog"')).toBe('Undid: Delete block "Auog"');
  });

  it("quietly reports an empty stack", () => {
    expect(undoToastMessage(null)).toBe("Nothing to undo");
  });
});
