import { expect, test, type Page } from "@playwright/test";

/**
 * Sticky page toolbars (#106): the shared `PageHeader` sticks to the top of its
 * scroll container so the title and the toolbar that drives the content below stay
 * reachable on long pages. Read-only — scrolling writes nothing.
 *
 * A short viewport guarantees the page overflows and actually scrolls. We assert the
 * one `<header>` (only `PageHeader` renders one) does NOT move on screen when its
 * scroll container is scrolled to the bottom — a non-sticky header would ride up with
 * the content and leave the viewport.
 */

// The nearest scrollable ancestor of the header, scrolled to the bottom; returns how
// far it moved plus the header's on-screen top before/after, all measured in-page so
// we're checking the same container the app scrolls in (not the window).
async function scrollAndMeasure(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) throw new Error("no PageHeader on the page");
    let container: HTMLElement | null = header.parentElement;
    while (container) {
      const oy = getComputedStyle(container).overflowY;
      if ((oy === "auto" || oy === "scroll") && container.scrollHeight - container.clientHeight > 20)
        break;
      container = container.parentElement;
    }
    if (!container) throw new Error("no scrollable container around the PageHeader");

    const before = header.getBoundingClientRect().top;
    container.scrollTop = container.scrollHeight;
    const scrolled = container.scrollTop;
    const after = header.getBoundingClientRect().top;
    return { before, after, scrolled };
  });
}

// A short viewport so even a modest page overflows and scrolls.
test.use({ viewport: { width: 1024, height: 380 } });

// Settings scrolls inside the SidebarShell's inner region and always has content.
test("PageHeader stays pinned when the inner scroll region scrolls (settings)", async ({ page }) => {
  await page.goto("/settings");
  const heading = page.getByRole("heading", { name: "Settings" });
  await expect(heading).toBeVisible();

  const { before, after, scrolled } = await scrollAndMeasure(page);
  expect(scrolled, "the container actually scrolled").toBeGreaterThan(20);
  // sticky ⇒ the header's on-screen position is unchanged by the scroll
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  await expect(heading).toBeInViewport();
});

// Factory scrolls in the root container (the other code path) — skip if this project
// has no flows to fill the page.
test("PageHeader stays pinned when the root container scrolls (factory)", async ({ page }) => {
  await page.goto("/factory");
  const section = page.getByText(/^(Deficits|Surpluses|Balanced|Stock buffers)/).first();
  const noFlows = page.getByText("No flows yet");
  await expect(section.or(noFlows).first()).toBeVisible();
  if (await noFlows.isVisible()) test.skip(true, "no factory flows in the active project DB");

  const heading = page.getByRole("heading", { name: "Factory" });
  await expect(heading).toBeVisible();

  const { before, after, scrolled } = await scrollAndMeasure(page);
  expect(scrolled, "the container actually scrolled").toBeGreaterThan(20);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  await expect(heading).toBeInViewport();
});
