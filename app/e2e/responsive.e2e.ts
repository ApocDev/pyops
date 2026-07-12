import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Responsive screenshot harness.
 *
 * Not a pass/fail test — a *capture* tool for the mobile/tablet effort. It shoots
 * every top-level UI route at a viewport matrix into `screenshots/<label>/`, so we
 * can (a) eyeball the mobile/tablet/Deck sheets and (b) diff the desktop widths
 * against a saved baseline to prove desktop didn't regress.
 *
 * Run against the already-running dev server (reuseExistingServer):
 *   SHOT_LABEL=baseline E2E_PORT=3000 npx playwright test responsive
 *   # ...make changes...
 *   SHOT_LABEL=after    E2E_PORT=3000 npx playwright test responsive
 *
 * Desktop widths (1920/1280) are the regression reference; tablet/phone are the
 * "did mobile get fixed" sheet. The Steam Deck (1280×800) is width-identical to
 * desktop-1280 — its problems are *touch* (drag/dnd, hover-only affordances), which
 * a screenshot can't show, so the Deck is verified behaviorally via Playwright MCP,
 * not here.
 */

const LABEL = process.env.SHOT_LABEL ?? "baseline";

const VIEWPORTS = [
  { name: "desktop-1920", width: 1920, height: 1080 }, // regression reference
  { name: "desktop-1280", width: 1280, height: 800 }, // regression reference (= Deck width)
  { name: "tablet-834", width: 834, height: 1112 }, // iPad portrait
  { name: "phone-390", width: 390, height: 844 }, // iPhone-class
] as const;

// Top-level UI routes (api routes excluded). block/$id is captured by entering the
// first block from /block, since it needs a real id.
const ROUTES = [
  "/",
  "/block",
  "/factory",
  "/explore",
  "/explore/dependencies",
  "/factory/connections",
  "/turd",
  "/factory/scenario",
  "/assistant",
  "/tasks",
  "/settings",
] as const;

const slug = (route: string) => (route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "_"));

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      test(`${slug(route)}`, async ({ page }) => {
        const dir = path.join("screenshots", LABEL, vp.name);
        fs.mkdirSync(dir, { recursive: true });
        // domcontentloaded, not networkidle: polling routes (assistant, bridge) never
        // go idle and would time out. Wait on the chrome instead, then a short settle.
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("nav").getByRole("link", { name: "PyOps" })).toBeVisible();
        await page.waitForTimeout(800); // let layout/data settle
        await page.screenshot({ path: path.join(dir, `${slug(route)}.png`), fullPage: true });
        // Guard: no page should scroll sideways at tablet/phone widths. Item names get
        // truncated, not pushed off-screen. (Desktop widths are exempt — wide data
        // dashboards there can legitimately exceed a small window.)
        //
        // The app scrolls inside the content container (the div after <nav>), not the
        // window — so measure THAT, or content overflow hides from documentElement.
        if (vp.width <= 834) {
          const overflow = await page.evaluate(() => {
            const content = document.querySelector("[data-app-content]");
            const el = content ?? document.documentElement;
            return el.scrollWidth - el.clientWidth;
          });
          expect(overflow, `${route} @ ${vp.name} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}
