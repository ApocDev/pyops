import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, addGoal, createBlock, dragFlowNode, goto } from "./helpers";

const flowPositions = (blockId: number): Record<string, { x: number; y: number }> | null => {
  const db = new DatabaseSync(activeProjectDbFile());
  try {
    const row = db.prepare("SELECT flow_positions AS p FROM blocks WHERE id = ?").get(blockId) as
      | { p: string | null }
      | undefined;
    return row?.p ? (JSON.parse(row.p) as Record<string, { x: number; y: number }>) : null;
  } finally {
    db.close();
  }
};

/**
 * The block flow view (#101): a solved block can be viewed as a layered
 * material-flow diagram instead of the recipe table. This drives the main flow —
 * build a tiny block, switch to the Flow tab, confirm the diagram renders with a
 * recipe node, then click that node and confirm it jumps back to the table row.
 */
test("the flow view renders a block's material flow and a node focuses its table row", async ({
  page,
}) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");

  // add a producer for the goal so the block has a running recipe (and thus a
  // node + links in the diagram) — the goal card's "make this goal" affordance.
  await page.locator('button[aria-label^="Add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(picker).toBeHidden();

  // switch to the Flow view; the diagram panel and a clickable recipe node appear
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.getByText("Material flow")).toBeVisible();
  const recipeNode = page.locator('button[title$="click to open in the table"]').first();
  await expect(recipeNode).toBeVisible();

  // clicking a recipe node returns to the table and focuses that recipe's row
  // ("Table" must be exact — "craftable" chip labels otherwise match the name).
  await recipeNode.click();
  await expect(page.getByText("Material flow")).toBeHidden();
  await expect(page.getByRole("button", { name: "Table", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Ingredients ↓", { exact: false }).first()).toBeVisible();
});

/** Flow nodes are draggable and their positions persist per block, with
 * Auto-arrange clearing them back to the computed layout. */
test("flow nodes can be arranged by hand and auto-arrange resets them", async ({ page }) => {
  const blockId = await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await page.locator('button[aria-label^="Add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(picker).toBeHidden();

  await page.getByRole("button", { name: "Flow", exact: true }).click();
  const node = page.locator('.react-flow__node[data-id^="r:"]').first();
  await expect(node).toBeVisible();
  const nodeId = (await node.getAttribute("data-id"))!;
  // let the post-edit re-solve land first: a fresh layout rebuilds the nodes,
  // which would reset a node mid-drag
  await expect
    .poll(async () => node.evaluate((el) => (el as HTMLElement).style.transform), {
      timeout: 10_000,
    })
    .toBe(await node.evaluate((el) => (el as HTMLElement).style.transform));
  await page.waitForTimeout(500);

  const moved = await dragFlowNode(page, nodeId, -160, 120);
  expect(moved.after, "the node should move on screen").not.toBe(moved.before);

  // exactly the dragged node is persisted
  await expect.poll(() => Object.keys(flowPositions(blockId) ?? {}), { timeout: 10_000 }).toEqual([
    nodeId,
  ]);

  // the hand-placed spot survives a reload
  await goto(page, `/block/${blockId}`);
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  const saved = flowPositions(blockId)![nodeId];
  await expect(page.locator(`.react-flow__node[data-id="${nodeId}"]`)).toHaveAttribute(
    "style",
    new RegExp(`translate\\(${saved.x}px, ${saved.y}px\\)`),
  );

  // auto-arrange drops every stored position
  await page.getByRole("button", { name: /Auto-arrange/ }).click();
  await expect.poll(() => flowPositions(blockId), { timeout: 10_000 }).toBeNull();
});
