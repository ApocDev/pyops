import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import { activeProjectDbFile, dragFlowNode, goto } from "./helpers";

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

const allBlocks = (page: Page) =>
  page.getByRole("group", { name: "Board view" }).getByRole("button", { name: /All blocks/ });

const firstEnabledBlock = (): { id: number; name: string } => {
  const db = new DatabaseSync(activeProjectDbFile());
  try {
    return db.prepare("SELECT id, name FROM blocks WHERE enabled = 1 ORDER BY id LIMIT 1").get() as {
      id: number;
      name: string;
    };
  } finally {
    db.close();
  }
};

/** The Board opens on shortfalls (the seeded project has short goods), and
 * search focuses a block with its direct neighbors. */
test("factory board opens on shortfalls and search focuses a block", async ({ page }) => {
  await goto(page, "/factory/connections?view=board");
  const views = page.getByRole("group", { name: "Board view" });
  await expect(views.getByRole("button", { name: "Shortfalls" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 15_000 },
  );
  // short goods sit in the middle column as good nodes
  await expect(page.locator(".react-flow__node-good").first()).toBeVisible();

  const block = firstEnabledBlock();
  await page.getByPlaceholder("Focus a block or good…").fill(block.name);
  await page.getByRole("option", { name: block.name, exact: true }).last().click();
  await expect(page.locator(`.react-flow__node[data-id="b:${block.id}"]`)).toBeVisible();
  await expect(views.getByRole("button", { name: "Shortfalls" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // clearing the focus goes back to shortfalls
  await page.getByRole("button", { name: "Clear focus" }).click();
  await expect(views.getByRole("button", { name: "Shortfalls" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

/** Connections → Board: dragging a block persists its position (and only its
 * position), the spot survives a reload, and Auto-arrange resets to auto. */
test("factory board drag persists and auto-arrange resets", async ({ page }) => {
  clearPositions();
  try {
    await goto(page, "/factory/connections");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page).toHaveURL(/view=board/);
    await allBlocks(page).click();

    const node = page.locator(".react-flow__node").first();
    await expect(node).toBeVisible({ timeout: 15_000 });
    const nodeId = Number(await node.getAttribute("data-id"));

    const moved = await dragFlowNode(page, String(nodeId), -180, 140);
    expect(moved.after, "the node should move on screen").not.toBe(moved.before);
    await expect.poll(() => boardPositions().length, { timeout: 10_000 }).toBe(1);
    const saved = boardPositions()[0];
    expect(saved.id).toBe(nodeId);

    // the hand-placed position survives a reload, to the pixel
    await goto(page, "/factory/connections?view=board");
    await allBlocks(page).click();
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
