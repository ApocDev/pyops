// Seed the mutating suite's scratch data dir (.mut-data) with one fixture
// project, `e2e`, built from the source data dir's ACTIVE project:
//
//  1. Snapshot that project's db with sqlite's online-backup API, so a db the
//     read-only dev server already holds open still copies consistently.
//  2. Keep only its reference data (the Factorio dump: recipes, items, techs, …
//     — the same for anyone on the same mod set) and wipe every planning and
//     save-synced table (blocks, folders, pins, tasks, research, stats, …).
//  3. Set a fixed research state, so "unlocked now" means the same thing no
//     matter whose playthrough the dump came from.
//
// Specs then create the blocks, pins, and other planning rows they need. Nothing
// they see depends on which project the developer has active.
//
// Runs as the FIRST HALF of the mutating webServer command (see
// playwright.config.ts) — Playwright boots webServer plugins BEFORE
// globalSetup files run, so seeding from a globalSetup would race the server;
// chaining it into the command guarantees copy-then-boot. With
// reuseExistingServer, a warm server skips the command (and the re-seed)
// entirely, same as the read-only suite.
//
// Plain node (>= 22.5 for node:sqlite), no deps — this package stays tiny.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
// dev keeps its data in the app working dir (see src/server/paths.server.ts)
const sourceDir = process.env.PYOPS_SOURCE_DATA_DIR ?? join(here, "..");
const scratchDir = join(here, ".mut-data");
const FIXTURE_ID = "e2e";

/** Meta keys that describe the imported dump, plus the solver's projection
 * bookkeeping for it (without that, the first factory page to resolve blocks
 * changes Scenario's cache key mid-test). Every other meta key is a planning
 * preference or save-synced state, and is dropped. */
const REFERENCE_META = new Set([
  "data_fingerprint",
  "data_format_version",
  "default_item_weight",
  "dump_helper_fingerprint",
  "dump_mtime",
  "factorio_version",
  "imported_from",
  "migrations_applied",
  "mod_list",
  "rocket_lift_weight",
  "solve_projection_generation",
  "solve_projection_resolved_generation",
  "solve_projection_version",
  "synced_at",
]);

/** An early Py playthrough: steam power, coal processing, tar, py science 1.
 * Specs that check "Unlocked now" vs locked rely on this exact set. */
const RESEARCHED_TECHS = [
  "acetylene",
  "advanced-underground-piping",
  "alloys-mk01",
  "ash-separation",
  "automation",
  "automation-science-pack",
  "automobilism",
  "basic-substrate",
  "biotech-machines-mk01",
  "biotech-mk01",
  "bob-long-inserters-1",
  "bob-near-inserters",
  "botany-mk01",
  "cellulose-mk01",
  "ceramic",
  "coal-processing-1",
  "concrete",
  "copper-mk01",
  "creosote",
  "crusher",
  "electrolysis",
  "electronics",
  "enable-logistics-tab",
  "engine",
  "fast-wood-forestry-upgrade",
  "fluid-handling",
  "fluid-pressurization",
  "fluid-processing-machines-1",
  "gate",
  "genetics-mk01",
  "glass",
  "gun-turret",
  "hidden-mining-fluid-autounlock",
  "kerogen",
  "lamp",
  "land-animals-mk01",
  "landfill",
  "latex",
  "logistics",
  "military",
  "mining-with-fluid",
  "moondrop",
  "moondrop-upgrade",
  "moss-mk01",
  "petri-dish",
  "plastics",
  "py-asphalt",
  "py-science-pack-1",
  "py-storage-tanks",
  "radars-mk01",
  "rendering",
  "repair-pack",
  "sap-mk01",
  "scrude",
  "seaweed-mk01",
  "soil-washing",
  "solder-mk01",
  "steam-power",
  "steel-axe",
  "steel-processing",
  "stone-wall",
  "syngas",
  "tar-processing",
  "vrauks",
  "wood-processing",
  "xenobiology",
  "zoology",
];

/** The reference-data format the app's importer writes today. */
function currentDataFormat() {
  const source = readFileSync(join(here, "../src/lib/data-format.ts"), "utf8");
  const version = /REFERENCE_DATA_FORMAT_VERSION = (\d+)/.exec(source)?.[1];
  if (!version) throw new Error("[seed-mut-data] could not read REFERENCE_DATA_FORMAT_VERSION");
  return Number(version);
}

/** The tables a data sync fills, read from the importer so this list can't
 * drift from it. Everything else (besides meta and drizzle's bookkeeping) is
 * planning or save-synced state. */
function referenceTables() {
  const source = readFileSync(join(here, "../src/db/import-factorio.ts"), "utf8");
  const body = /const TABLES = \[([^\]]*)\]/.exec(source)?.[1];
  if (!body) throw new Error("[seed-mut-data] could not read TABLES from import-factorio.ts");
  return new Set([...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

const configFile = join(sourceDir, "app-config.json");
const sourceActive = existsSync(configFile)
  ? (JSON.parse(readFileSync(configFile, "utf8")).active ?? "default")
  : "default";
const sourceDb = join(sourceDir, "projects", `${sourceActive}.db`);
const fixtureDb = join(scratchDir, "projects", `${FIXTURE_ID}.db`);
if (!existsSync(sourceDb))
  throw new Error(`[seed-mut-data] the active project db ${sourceDb} does not exist`);

const src = new DatabaseSync(sourceDb, { readOnly: true });
try {
  // A stale dump makes the app open a blocking "Reference data is out of date"
  // dialog on every page, so every spec would time out. Fail here instead.
  const imported = src
    .prepare("SELECT value FROM meta WHERE key = 'data_format_version'")
    .get()?.value;
  const current = currentDataFormat();
  if (Number(imported) !== current)
    throw new Error(
      `[seed-mut-data] project "${sourceActive}" has reference data format ${imported ?? "unversioned"}, but the app reads v${current}. Re-sync it in the app (Settings › Game data) or switch to an up-to-date project, then rerun.`,
    );
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(join(scratchDir, "projects"), { recursive: true });
  await backup(src, fixtureDb);
} finally {
  src.close();
}

const db = new DatabaseSync(fixtureDb);
try {
  const keep = referenceTables();
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
    )
    .all()
    .map((row) => String(row.name))
    .filter((name) => name !== "meta" && !keep.has(name));
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  db.exec("BEGIN");
  // undo_current first: while it holds a row, the undo triggers log every delete
  db.exec("DELETE FROM undo_current");
  for (const table of tables) db.exec(`DELETE FROM "${table}"`);
  for (const { key } of db.prepare("SELECT key FROM meta").all())
    if (!REFERENCE_META.has(String(key))) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  setMeta.run("project_name", "E2E fixture");
  setMeta.run("project_created_at", new Date(0).toISOString());
  setMeta.run("research_mode", "future");
  setMeta.run("researched_techs", JSON.stringify(RESEARCHED_TECHS));
  db.exec("COMMIT");
} finally {
  db.close();
}

writeFileSync(join(scratchDir, "app-config.json"), `${JSON.stringify({ active: FIXTURE_ID })}\n`);

console.log(
  `[seed-mut-data] built the ${FIXTURE_ID} fixture project from ${sourceDb} (reference data only) in ${scratchDir}`,
);
