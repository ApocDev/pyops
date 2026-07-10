import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone E2E package — intentionally NOT part of the app's pnpm project, so
 * installing Playwright never re-resolves the app's `latest`/nightly toolchain
 * pins (which can pull a vitest-breaking nitro). Install + run from here:
 *
 *   cd app/e2e && npm install && npm test
 *
 * Two servers, two Playwright projects:
 *
 *  - `chromium` (the specs in this directory) runs READ-ONLY against a dev
 *    server on the app's real data dir — the active project DB, real reference
 *    data. Mod/bridge state is mocked per-spec (see bridge.e2e.ts).
 *  - `mutating` (the specs in mut/) runs against a SECOND dev server whose
 *    PYOPS_DATA_DIR points at a scratch copy of that data (e2e/.mut-data),
 *    seeded by seed-mut-data.mjs before the server boots — those specs edit
 *    blocks, delete things, create projects, with zero risk to your data.
 *
 * The seeding is chained into the mutating server's command (not a Playwright
 * globalSetup) because webServer plugins start BEFORE globalSetup runs — the
 * copy must land before the server opens the db.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MUT_PORT = Number(process.env.E2E_MUT_PORT ?? 3101);

const here = dirname(fileURLToPath(import.meta.url));
/** Scratch data dir for the mutating server — wiped + re-seeded on every cold start. */
export const MUT_DATA_DIR = join(here, ".mut-data");

// Desktop Chrome defaults to 1280×720, but the global nav only shows its
// full link bar from 1400px up (3b8d143) — pin a width where the nav
// assertions hold. responsive.e2e.ts overrides per-viewport.
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

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
  projects: [
    {
      name: "chromium",
      testIgnore: /\/mut\//,
      use: desktop,
    },
    {
      name: "mutating",
      testDir: "./mut",
      use: { ...desktop, baseURL: `http://localhost:${MUT_PORT}` },
    },
  ],
  webServer: [
    {
      // the read-only server: the app's real data dir (active project DB)
      command: `vp dev --port ${PORT}`,
      cwd: "..", // run the dev server from the app root
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // pin the UDP bridge to a known, non-default port so the fake-mod peer in
      // bridge.e2e.ts can reach it without clashing with a real mod/app on 37657
      env: {
        PYOPS_BRIDGE_PORT: "37659",
        PYOPS_NITRO_BUILD_DIR: "node_modules/.nitro-e2e-readonly",
      },
    },
    {
      // the mutating server: seed the scratch data dir, then boot against it
      command: `node e2e/seed-mut-data.mjs && vp dev --port ${MUT_PORT}`,
      cwd: "..",
      url: `http://localhost:${MUT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // its own bridge port too — two servers can't share a UDP socket, and the
      // default 37657 may belong to a real running app/mod
      env: {
        PYOPS_DATA_DIR: MUT_DATA_DIR,
        PYOPS_BRIDGE_PORT: "37661",
        PYOPS_NITRO_BUILD_DIR: "node_modules/.nitro-e2e-mutating",
      },
    },
  ],
});
