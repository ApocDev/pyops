import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone E2E package — intentionally NOT part of the app's pnpm project, so
 * installing Playwright never re-resolves the app's `latest`/nightly toolchain
 * pins (which can pull a vitest-breaking nitro). Install + run from here:
 *
 *   cd app/e2e && npm install && npm test
 *
 * The webServer boots `vp dev` in the parent app dir against the active project
 * DB (projects/*.db), so specs run against real reference data. Mod/bridge state
 * is mocked per-spec (see bridge.e2e.ts) — no running game required.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vp dev --port ${PORT}`,
    cwd: "..", // run the dev server from the app root
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
