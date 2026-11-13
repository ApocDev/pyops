import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

// The full desktop bar starts at 1400px, so its two narrowest widths are the
// ones that run short of room once both status chips show.
test("the desktop top bar fits with Data stale and a running assistant", async ({ page }) => {
  // An older data format raises Data stale (see data-format-drift.e2e.ts).
  const file = activeProjectDbFile();
  const db = new DatabaseSync(file);
  const original = db
    .prepare("SELECT value FROM meta WHERE key = 'data_format_version'")
    .get() as { value: string | null } | undefined;
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('data_format_version', '0') ON CONFLICT(key) DO UPDATE SET value = '0'",
  ).run();
  db.close();

  // Hold every send open, so the conversation stays generating ("1 running").
  await page.route("**/api/chat", (route) =>
    route.request().method() === "POST" ? new Promise<void>(() => {}) : route.fallback(),
  );

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, "/assistant");
    await page
      .getByRole("dialog", { name: "Reference data is out of date" })
      .getByRole("button", { name: "Ignore for now" })
      .click();
    await page.getByPlaceholder("Ask about a recipe or chain…").fill("hello");
    await page.keyboard.press("Enter");

    const nav = page.locator("nav").first();
    await expect(nav.getByRole("button", { name: "Data stale" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "1 running" })).toBeVisible();

    for (const width of [1440, 1400]) {
      await page.setViewportSize({ width, height: 900 });
      const fit = await nav.evaluate((el) => ({
        overflow: el.scrollWidth - el.clientWidth,
        // a wrapped label makes its chip taller than the 40px bar
        tallest: Math.max(
          ...[...el.querySelectorAll("a, button")]
            .filter((c) => c instanceof HTMLElement && c.offsetParent)
            .map((c) => c.getBoundingClientRect().height),
        ),
      }));
      expect(fit.overflow, `top bar overflows at ${width}px`).toBeLessThanOrEqual(0);
      expect(fit.tallest, `a top bar label wraps at ${width}px`).toBeLessThanOrEqual(40);
      const settings = await nav.getByRole("link", { name: "Settings" }).boundingBox();
      expect(settings!.x + settings!.width).toBeLessThanOrEqual(width);
    }
  } finally {
    const restore = new DatabaseSync(file);
    if (original) {
      restore
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('data_format_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(original.value);
    } else {
      restore.prepare("DELETE FROM meta WHERE key = 'data_format_version'").run();
    }
    restore.close();
  }
});
