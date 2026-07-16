import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Theme toggle (#107): Settings → Display → Theme flips the `.dark` class and
 * `color-scheme` on <html> and persists across a reload. This exercises the
 * switching mechanism; the rendered contrast contract is covered below.
 */
test("theme toggle flips the dark class and persists", async ({ page }) => {
  await page.goto("/settings?tab=planning");

  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/); // dark is the default

  // switch to light
  // the theme Select trigger shows the current value; open it and pick Light
  await page.locator('[data-slot="select-trigger"]').filter({ hasText: /Dark|Light|System/ }).first().click();
  await page.getByRole("option", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveJSProperty("style.colorScheme", "light");

  // the pre-paint script keeps it light across a reload (no flash back to dark)
  await page.reload();
  await expect(html).not.toHaveClass(/dark/);

  // back to dark for the rest of the suite's assumptions
  await page.goto("/settings?tab=planning");
  await page.getByRole("combobox").filter({ hasText: /Dark|Light|System/ }).first().click();
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);
});

const CONTRAST_ROUTES = ["/", "/block", "/factory", "/assistant", "/settings"] as const;

for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme keeps representative routes contrast-safe`, async ({ page }) => {
    await page.addInitScript((preference) => {
      localStorage.setItem("pyops.theme", preference);
    }, theme);

    const failures: string[] = [];
    for (const route of CONTRAST_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("nav").getByRole("link", { name: "PyOps" })).toBeVisible();
      await page.waitForTimeout(250);

      await page.evaluate(() => {
        const fixture = document.createElement("div");
        fixture.setAttribute("data-theme-contrast-fixture", "");
        Object.assign(fixture.style, {
          position: "fixed",
          top: "40px",
          left: "0",
          zIndex: "99999",
          fontSize: "14px",
          fontWeight: "400",
        });

        const pairs = [
          ["foreground", "var(--foreground)", "var(--background)"],
          ["muted", "var(--muted-foreground)", "var(--background)"],
          ["primary", "var(--primary)", "var(--background)"],
          ["primary action", "var(--primary-foreground)", "var(--primary-solid)"],
          ...["success", "warning", "info", "surplus"].flatMap((token) => [
            [token, `var(--${token})`, "var(--background)"],
            [
              `${token} tint`,
              `var(--${token})`,
              `color-mix(in oklab, var(--${token}) 10%, var(--background))`,
            ],
          ]),
        ];

        for (const [label, color, backgroundColor] of pairs) {
          const sample = document.createElement("span");
          sample.textContent = label;
          Object.assign(sample.style, { display: "block", color, backgroundColor });
          fixture.append(sample);
        }
        document.body.append(fixture);
      });

      const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      for (const violation of result.violations) {
        for (const node of violation.nodes) {
          failures.push(
            `${route} ${node.target.join(" ")}: ${node.failureSummary ?? violation.help}`,
          );
        }
      }
    }

    expect(failures, failures.join("\n\n")).toEqual([]);
  });
}
