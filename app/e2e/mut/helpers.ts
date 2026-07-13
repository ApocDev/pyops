/**
 * Shared helpers for the mutating suite (mut/). Everything here talks to the
 * ISOLATED dev server (see playwright.config.ts): its PYOPS_DATA_DIR is the
 * scratch copy under e2e/.mut-data, so these tests can create/edit/delete
 * freely. Specs create the entities they mutate (with per-run unique names, so
 * a re-run against a warm server never collides) instead of depending on what
 * the copied db happens to contain.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/** The mutating server's scratch data dir (seeded by seed-mut-data.mjs). */
export const MUT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".mut-data");

/** The sqlite file of the scratch copy's ACTIVE project (what the isolated
 * server reads/writes) — for the rare direct-db assertions/arrangements. */
export function activeProjectDbFile(): string {
  const configFile = join(MUT_DATA_DIR, "app-config.json");
  let active = "default";
  if (existsSync(configFile)) {
    const parsed = JSON.parse(readFileSync(configFile, "utf8")) as { active?: string };
    if (typeof parsed.active === "string" && parsed.active) active = parsed.active;
  }
  return join(MUT_DATA_DIR, "projects", `${active}.db`);
}

/** A per-run unique display name, so re-runs against a reused (still-warm)
 * server never trip over entities a previous run created. */
export function uniqueName(label: string): string {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * Navigate and wait until the app is HYDRATED, not just SSR-painted. These
 * specs drive hotkeys and buttons immediately after navigation; on a cold vite
 * dev server the SSR chrome renders seconds before React attaches handlers, so
 * an eager keypress/click lands on dead markup. React marks hydrated DOM with
 * `__reactFiber$…` expando props — wait for that on the nav.
 */
export async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator("nav").getByRole("link", { name: "PyOps" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => {
      const nav = document.querySelector("nav");
      return !!nav && Object.keys(nav).some((k) => k.startsWith("__reactFiber$"));
    },
    { timeout: 30_000 },
  );
}

/** The nav's undo affordance. Its accessible name is the tooltip:
 * `Undo: <action>` or `Nothing to undo`. */
export function undoButton(page: Page) {
  return page.locator("nav").getByRole("button", { name: /^(Undo:|Nothing to undo)/ });
}

/** Wait until the top of the undo stack names `action` — the reliable signal
 * that the editor's debounced auto-save actually landed in the db. */
export async function expectUndoTop(page: Page, action: RegExp): Promise<void> {
  await expect(page.locator("nav").getByRole("button", { name: action })).toBeVisible({
    timeout: 15_000,
  });
}

/** Create a fresh block via the sidebar's "new block" button and land in its
 * editor. Returns the block id from the URL. */
export async function createBlock(page: Page): Promise<number> {
  await goto(page, "/block");
  const previousUrl = page.url();
  await page.getByRole("button", { name: "new block", exact: true }).click();
  await page.waitForURL((url) => url.href !== previousUrl && /\/block\/\d+$/.test(url.pathname));
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  expect(id).toBeGreaterThan(0);
  // wait for the editor's doc store to hydrate the fresh block — editing
  // before that races the load (a fill can interleave with hydration). A rapid
  // second creation can retain the previous route's doc store until a hard
  // hydration; reload the already-created id only when that transition stalls.
  try {
    await expect(blockNameInput(page)).toHaveValue("New block", { timeout: 2_000 });
  } catch {
    await page.reload();
    await expect(blockNameInput(page)).toHaveValue("New block", { timeout: 15_000 });
  }
  return id;
}

/** The block editor's name input (typing a name pins it as custom). */
export function blockNameInput(page: Page) {
  return page.getByPlaceholder("auto-named from goal…");
}

/** Add a goal product to the open block editor via the goal picker.
 * Searches `query` and picks the result whose display name is `display`. */
export async function addGoal(page: Page, query = "iron plate", display = "Iron plate") {
  // the "+ goal" cell: its visible text is just "goal", the title carries intent
  await page.locator('button[title="add a goal product"]').click();
  const dialog = page.getByRole("dialog", { name: "Add a goal product" });
  await dialog.getByPlaceholder("search an item or fluid…").fill(query);
  await dialog.getByRole("button", { name: display, exact: true }).click();
  await expect(dialog).toBeHidden();
  // the goal cell appears with the default pinned rate of 1/s
  await expect(goalRateButton(page)).toHaveText("1");
}

/** The goal cell's clickable rate (EditableRate's display state). */
export function goalRateButton(page: Page) {
  return page.locator('button[title^="click to edit the goal rate"]');
}

/** Change the global planning horizon through the same header dialog a player
 * uses. Advanced-recipe specs opt into Future explicitly now that locked recipe
 * picker rows are intentionally disabled in Now mode. */
export async function setPlanningHorizon(
  page: Page,
  mode: "Now" | "Future" | "Up to target",
): Promise<void> {
  await page.getByRole("button", { name: /^Horizon:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Planning horizon" });
  const choice = dialog.getByRole("button", { name: mode, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** Click the goal rate, type a new value, commit with Enter. */
export async function setGoalRate(page: Page, value: string): Promise<void> {
  await goalRateButton(page).click();
  const input = page.locator("input:focus");
  await input.fill(value);
  await input.press("Enter");
  await expect(goalRateButton(page)).toHaveText(value);
}

/** A toast by (partial) message. Toasts auto-dismiss after ~4s, so assert on
 * this promptly after the triggering action. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole("status").filter({ hasText: text });
}

/** A block's row in the /block sidebar tree (the row div that carries both the
 * open button and the hover-revealed delete ×). */
export function sidebarBlockRow(page: Page, name: string) {
  return page
    .getByRole("complementary")
    .locator("div")
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .last();
}
