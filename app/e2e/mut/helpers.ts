/**
 * Shared helpers for the mutating suite (mut/). Everything here talks to the
 * ISOLATED dev server (see playwright.config.ts): its PYOPS_DATA_DIR is the
 * scratch `e2e` fixture project under e2e/.mut-data, which starts with
 * reference data only (see seed-mut-data.mjs). Specs create the entities they
 * need (with per-run unique names, so a re-run against a warm server never
 * collides) instead of depending on what a developer's project contains.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

/** Open the scratch project's db, run `fn`, and close it again. For direct
 * arrangements and assertions that the UI can't express cheaply. */
export function withDb<T>(fn: (db: DatabaseSync) => T, options: { readOnly?: boolean } = {}): T {
  const db = new DatabaseSync(activeProjectDbFile(), options);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return fn(db);
  } finally {
    db.close();
  }
}

/** The subset of a block document (`blocks.data`) that specs write directly. */
export type BlockDoc = {
  goals: { name: string; rate: number; stock?: number; window?: number; temperature?: number }[];
  recipes: string[];
  made?: string[];
  pins?: { kind: string; recipe: string; item?: string; count?: number }[];
  machines?: Record<string, string>;
  fuels?: Record<string, string>;
  fluidTemperatures?: Record<string, Record<string, number>>;
  supplyPriority?: number;
};

/** Insert a block row straight into the scratch db and return its id. The
 * server solves it the first time anything reads it. */
export function insertBlock(name: string, doc: BlockDoc): number {
  return withDb((db) =>
    Number(
      db.prepare("INSERT INTO blocks (name, data) VALUES (?, ?)").run(name, JSON.stringify(doc))
        .lastInsertRowid,
    ),
  );
}

/** Delete every block (with its solved rows and snapshots) and the factory
 * pins. Factory-wide views like Scenario solve every block in the project, so
 * their specs start from an empty factory instead of whatever earlier specs
 * left behind. */
export function clearFactory(): void {
  withDb((db) => {
    for (const table of ["block_flows", "block_machines", "block_snapshots"])
      db.exec(`DELETE FROM ${table}`);
    db.exec("DELETE FROM blocks");
    db.exec("DELETE FROM meta WHERE key = 'factory_pins_v1'");
  });
}

/** Replace the factory pins (the Scenario page's demands). */
export function setFactoryPins(pins: { good: string; kind: "item" | "fluid"; rate: number }[]) {
  withDb((db) =>
    db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('factory_pins_v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(pins)),
  );
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
  // /block can redirect to the last open block just after it loads, which can
  // swallow the click; retry until the URL names a block newer than any before
  const lastId = withDb(
    (db) => (db.prepare("SELECT MAX(id) AS id FROM blocks").get() as { id: number | null }).id ?? 0,
    { readOnly: true },
  );
  const isNew = (url: URL) => Number(/^\/block\/(\d+)$/.exec(url.pathname)?.[1]) > lastId;
  await expect(async () => {
    if (isNew(new URL(page.url()))) return;
    // by title: sidebar rows of blocks still named "New block" share the name
    await page.locator('button[title="New block"]').click();
    await page.waitForURL(isNew, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  const id = Number(new URL(page.url()).pathname.split("/").pop());
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
  return page.getByPlaceholder("Auto-named from goal…");
}

/** Add a goal product to the open block editor via the goal picker.
 * Searches `query` and picks the result whose display name is `display`. */
export async function addGoal(page: Page, query = "iron plate", display = "Iron plate") {
  // the "+ goal" cell: its visible text is just "goal", the title carries intent
  await page.locator('button[title="Add a goal product"]').click();
  const dialog = page.getByRole("dialog", { name: "Add a goal product" });
  await dialog.getByPlaceholder("Search an item or fluid…").fill(query);
  await dialog.getByRole("button", { name: display, exact: true }).click();
  await expect(dialog).toBeHidden();
  // the goal cell appears with the default pinned rate of 1/s
  await expect(goalRateButton(page)).toHaveText("1");
}

/** The goal cell's clickable rate (EditableRate's display state). */
export function goalRateButton(page: Page) {
  return page.locator('button[title^="Click to edit the goal rate"]');
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

/** Click the goal rate, type a new value, commit with Enter. `shown` is the
 * rounded display when it differs from what was typed. */
export async function setGoalRate(page: Page, value: string, shown = value): Promise<void> {
  await goalRateButton(page).click();
  const input = page.locator("input:focus");
  await input.fill(value);
  await input.press("Enter");
  await expect(goalRateButton(page)).toHaveText(shown);
}

/** A toast by (partial) message. Toasts auto-dismiss after ~4s, so assert on
 * this promptly after the triggering action. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole("status").filter({ hasText: text });
}

/**
 * Drag a React Flow node (factory board or block flow view) by `dx`/`dy` and
 * return its transform before/after. Dispatches the mouse events d3-drag — the
 * engine React Flow drives its nodes with — actually listens for: Playwright's
 * `dragTo` does not reliably start a d3 drag on these nodes, and a drag that
 * never moves the node is silently a no-op (the app only persists real moves).
 */
export async function dragFlowNode(
  page: Page,
  nodeId: string,
  dx: number,
  dy: number,
): Promise<{ before: string; after: string }> {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).scrollIntoViewIfNeeded();
  return page.evaluate(
    ([id, ddx, ddy]) =>
      new Promise<{ before: string; after: string }>((resolve) => {
        const el = document.querySelector(`.react-flow__node[data-id="${id as string}"]`);
        if (!el) throw new Error(`no flow node ${String(id)}`);
        const before = (el as HTMLElement).style.transform;
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const mk = (type: string, x: number, y: number, buttons: number) =>
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons,
            clientX: x,
            clientY: y,
          });
        el.dispatchEvent(mk("mousedown", cx, cy, 1));
        let i = 0;
        const step = () => {
          i++;
          window.dispatchEvent(
            mk("mousemove", cx + ((ddx as number) * i) / 8, cy + ((ddy as number) * i) / 8, 1),
          );
          if (i < 8) requestAnimationFrame(step);
          else {
            window.dispatchEvent(mk("mouseup", cx + (ddx as number), cy + (ddy as number), 0));
            setTimeout(() => resolve({ before, after: (el as HTMLElement).style.transform }), 300);
          }
        };
        requestAnimationFrame(step);
      }),
    [nodeId, dx, dy] as const,
  );
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
