import { expect, test } from "@playwright/test";
import { goto } from "./helpers";

/**
 * The recipe explorer (#97): the browse detail pane ranks a good's producing/
 * consuming recipes — grouped by research-horizon availability, ordered by
 * estimated economy flow, annotated with waste % — and filters them through
 * the shared filtered-list primitive (#87). Lives in the mutating suite
 * because the "compute now" affordance (a pre-#97 cost analysis lacks the
 * flow/waste scopes) writes the recompute into the project db.
 */

const NONSENSE = "zzz-no-such-thing-e2e";

test("explorer ranks producers/consumers by availability and filters them", async ({ page }) => {
  test.setTimeout(240_000); // may run a full cost-analysis LP over the project db

  await goto(page, "/browse?sel=iron-plate");
  const produced = page.getByText(/^Produced by \(\d+\)$/);
  const consumed = page.getByText(/^Consumed by \(\d+\)$/);
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  if (!(await produced.isVisible())) {
    test.skip(true, "no iron-plate in the active project DB");
  }
  await expect(consumed).toBeVisible();

  // a cost analysis from before the flow/waste scopes offers a one-click
  // recompute — run it so the ranked annotations below are real
  const stale = page.getByText(/hasn't been computed/);
  if (await stale.isVisible()) {
    await page.getByRole("button", { name: "compute now" }).click();
    await expect(stale).toBeHidden({ timeout: 200_000 });
  }

  // availability grouping + ranked annotations (both lists share the headers,
  // so assert on the first)
  await expect(page.getByText("Available now").first()).toBeVisible();
  await expect(page.getByText(/% waste$/).first()).toBeVisible();

  // long lists stay capped behind the shared show-all affordance
  const consumers = Number(/\((\d+)\)/.exec((await consumed.textContent()) ?? "")?.[1] ?? 0);
  if (consumers > 25) {
    await expect(page.getByRole("button", { name: /^show all \d+…$/ })).toBeVisible();
  }

  // the shared recipe filter (#87) narrows both lists and offers the standard
  // no-matches state per list
  const input = page.getByPlaceholder("filter recipes…");
  await input.fill(NONSENSE);
  await expect(page.getByText(`No matches for "${NONSENSE}"`).first()).toBeVisible();
  await page.getByRole("button", { name: "clear filter" }).first().click();
  await expect(input).toHaveValue("");
  await expect(page.getByText("Available now").first()).toBeVisible();
});
