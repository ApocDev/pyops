import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

const boardPositions = (): { id: number; x: number; y: number }[] => {
  const db = new DatabaseSync(activeProjectDbFile());
  try {
    return db
      .prepare("SELECT id, board_x AS x, board_y AS y FROM blocks WHERE board_x IS NOT NULL")
      .all() as { id: number; x: number; y: number }[];
  } finally {
    db.close();
  }
};

const clearPositions = () => {
  const db = new DatabaseSync(activeProjectDbFile());
  try {
    db.prepare("UPDATE blocks SET board_x = NULL, board_y = NULL").run();
  } finally {
    db.close();
  }
};

/** Connections → Board: dragging a block persists its position (and only its
 * position), the spot survives a reload, and Auto-arrange resets to auto. */
test("factory board drag persists and auto-arrange resets", async ({ page }) => {
  clearPositions();
  try {
    await goto(page, "/factory/connections");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page).toHaveURL(/view=board/);

    const node = page.locator(".react-flow__node").first();
    await expect(node).toBeVisible({ timeout: 15_000 });
    const nodeId = Number(await node.getAttribute("data-id"));

    // drag the node onto the minimap corner — any distinct spot will do
    await node.dragTo(page.locator(".react-flow__minimap"));
    await expect.poll(() => boardPositions().length, { timeout: 10_000 }).toBe(1);
    const saved = boardPositions()[0];
    expect(saved.id).toBe(nodeId);

    // the hand-placed position survives a reload, to the pixel
    await goto(page, "/factory/connections?view=board");
    const restored = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
    await expect(restored).toBeVisible({ timeout: 15_000 });
    await expect(restored).toHaveCSS("transform", /matrix/);
    const transform = await restored.evaluate((el) => el.style.transform);
    expect(transform).toBe(`translate(${saved.x}px, ${saved.y}px)`);

    // auto-arrange clears every stored position back to auto-layout
    await page.getByRole("button", { name: /Auto-arrange/ }).click();
    await expect.poll(() => boardPositions().length, { timeout: 10_000 }).toBe(0);
  } finally {
    clearPositions();
  }
});
