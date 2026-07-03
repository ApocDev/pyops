// Seed the mutating suite's scratch data dir (.mut-data) from the app's real
// data dir: app-config.json + every projects/*.db, snapshotted with sqlite's
// online-backup API so a db the read-only dev server already holds open still
// copies consistently (WAL and all).
//
// Runs as the FIRST HALF of the mutating webServer command (see
// playwright.config.ts) — Playwright boots webServer plugins BEFORE
// globalSetup files run, so seeding from a globalSetup would race the server;
// chaining it into the command guarantees copy-then-boot. With
// reuseExistingServer, a warm server skips the command (and the re-seed)
// entirely, same as the read-only suite.
//
// Plain node (>= 22.5 for node:sqlite), no deps — this package stays tiny.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
// dev keeps its data in the app working dir (see src/server/paths.server.ts)
const sourceDir = process.env.PYOPS_SOURCE_DATA_DIR ?? join(here, "..");
const scratchDir = join(here, ".mut-data");

rmSync(scratchDir, { recursive: true, force: true });
mkdirSync(join(scratchDir, "projects"), { recursive: true });

const appConfig = join(sourceDir, "app-config.json");
if (existsSync(appConfig)) copyFileSync(appConfig, join(scratchDir, "app-config.json"));

const projectsDir = join(sourceDir, "projects");
const dbs = existsSync(projectsDir)
  ? readdirSync(projectsDir).filter((f) => f.endsWith(".db"))
  : [];
for (const file of dbs) {
  const src = new DatabaseSync(join(projectsDir, file), { readOnly: true });
  try {
    await backup(src, join(scratchDir, "projects", file));
  } finally {
    src.close();
  }
}

console.log(
  `[seed-mut-data] copied ${dbs.length} project db(s)${existsSync(appConfig) ? " + app-config.json" : ""} from ${sourceDir} into ${scratchDir}`,
);
