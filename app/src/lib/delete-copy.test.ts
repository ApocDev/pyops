import { describe, expect, it } from "vite-plus/test";

import { blockDeleteDescription, countNoun, deletedMessage } from "./delete-copy";

describe("countNoun", () => {
  it("pluralizes with a simple s", () => {
    expect(countNoun(0, "recipe")).toBe("0 recipes");
    expect(countNoun(1, "recipe")).toBe("1 recipe");
    expect(countNoun(2, "goal")).toBe("2 goals");
  });
});

describe("blockDeleteDescription", () => {
  it("states the block name and what its deletion destroys", () => {
    expect(blockDeleteDescription("Iron plates", 12, 1)).toBe(
      'Delete "Iron plates"? This destroys its 12 recipes and 1 goal. You can undo this afterwards.',
    );
  });

  it("says an empty block is empty instead of counting zeros", () => {
    expect(blockDeleteDescription("New block", 0, 0)).toBe(
      'Delete "New block"? It is empty. You can undo this afterwards.',
    );
  });

  it("counts a goal-only block", () => {
    expect(blockDeleteDescription("Sketch", 0, 2)).toBe(
      'Delete "Sketch"? This destroys its 0 recipes and 2 goals. You can undo this afterwards.',
    );
  });
});

describe("deletedMessage", () => {
  it("quotes the label", () => {
    expect(deletedMessage("Iron plates")).toBe('Deleted "Iron plates"');
  });
});
