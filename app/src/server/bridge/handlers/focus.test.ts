import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BridgeRequest } from "../protocol.ts";

vi.mock("../../../db/recipe-blocks.server.ts", () => ({
  blocksUsingRecipe: vi.fn(() => []),
  recipeFocusInfo: vi.fn(() => null),
}));

const rb = await import("../../../db/recipe-blocks.server.ts");
const { handleBlockFocus } = await import("./focus.ts");
const { lastOpenRequest } = await import("../open-request.ts");

const req = (payload: unknown): BridgeRequest => ({
  protocol_version: 11,
  type: "block.focus",
  request_id: "r1",
  payload,
});

const PLATE = { name: "plate", kind: "item" } as const;

beforeEach(() => {
  vi.mocked(rb.blocksUsingRecipe).mockReturnValue([]);
  vi.mocked(rb.recipeFocusInfo).mockReturnValue({ display: "Smelt ore", good: PLATE });
});

describe("block.focus", () => {
  it("opens the one block that runs the recipe", () => {
    vi.mocked(rb.blocksUsingRecipe).mockReturnValue([{ id: 7, name: "Plates" }]);
    expect(handleBlockFocus(req({ recipe: "smelt" }))).toEqual({
      type: "block.focused",
      request_id: "r1",
      payload: { count: 1, result: "block", block: "Plates" },
    });
    expect(lastOpenRequest()).toMatchObject({ to: "block", id: 7 });
  });

  it("opens the good's resource view when several blocks run it, never picking one", () => {
    vi.mocked(rb.blocksUsingRecipe).mockReturnValue([
      { id: 7, name: "Plates" },
      { id: 8, name: "More plates" },
    ]);
    expect(handleBlockFocus(req({ recipe: "smelt" }))?.payload).toEqual({
      count: 2,
      result: "several",
    });
    expect(lastOpenRequest()).toMatchObject({ to: "good", recipe: "smelt", good: PLATE });
  });

  it("nudges to create a block when none runs it", () => {
    expect(handleBlockFocus(req({ recipe: "smelt" }))?.payload).toMatchObject({
      result: "none",
      count: 0,
    });
    expect(lastOpenRequest()).toMatchObject({ to: "none", label: "Smelt ore", good: PLATE });
  });

  it("ignores a payload without a recipe", () => {
    const before = lastOpenRequest();
    expect(handleBlockFocus(req({}))).toBeNull();
    expect(handleBlockFocus(req({ recipe: 3 }))).toBeNull();
    expect(lastOpenRequest()).toBe(before);
  });
});
