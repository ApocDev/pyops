/**
 * Server-side Factorio data sync: orchestrates the three game dumps,
 * the db import, and the icon-atlas rebuild — no manual steps.
 *
 * Pipeline (runDataSync):
 *   1. write the pyops-dump helper mod + enable it in mod-list.json
 *      (it sets data.data_crawler so pypostprocessing's planner integration
 *      runs: TURD sub-techs become real technologies, then patches the
 *      prototypes that integration leaves engine-invalid)
 *   2. factorio --dump-data / --dump-prototype-locale / --dump-icon-sprites
 *   3. restore mod-list.json (the helper must NEVER stay enabled for play)
 *   4. import the dump into sqlite (tsx src/db/import-factorio.ts)
 *   5. rebuild the icon atlas (scripts/build-icon-atlas.mjs)
 *   6. stamp the mod-list fingerprint into meta
 *
 * Long-running (~1-2 min): state is held in-module and polled by the UI.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";

const FACTORIO_BIN =
  process.env.FACTORIO_BIN ??
  join(homedir(), ".local/share/Steam/steamapps/common/Factorio/bin/x64/factorio");
const FACTORIO_DATA = process.env.FACTORIO_DATA_DIR ?? join(homedir(), ".factorio");
const MODS_DIR = join(FACTORIO_DATA, "mods");
const SCRIPT_OUTPUT = join(FACTORIO_DATA, "script-output");
const APP_DIR = process.cwd();
const ATLAS_SCRIPT = resolve(APP_DIR, "../scripts/build-icon-atlas.mjs");
const ICON_DATA = join(APP_DIR, "icon-data");

/* ── helper mod ──────────────────────────────────────────────────────────────── */

const HELPER_INFO = {
  name: "pyops-dump",
  version: "0.1.0",
  title: "PyOps dump helper",
  author: "PyOps",
  factorio_version: "2.0",
  description:
    "Enables pypostprocessing's planner (YAFC) integration during data dumps so TURD sub-techs and planner-friendly prototypes land in data-raw-dump.json. Enable ONLY while dumping - do not play with this mod active.",
  dependencies: ["? pypostprocessing"],
};

const HELPER_DATA_LUA = `-- pypostprocessing's data-final-fixes checks this marker and, when it starts
-- with "yafc ", rewrites the data stage for planner consumption: TURD sub-techs
-- become real technologies (turd-select-* gates + unlock effects), TURD modules
-- get recipes, smart-farms get representable fluids, etc.
data.data_crawler = "yafc pyops"
`;

const HELPER_FINAL_FIXES_LUA = `-- pypostprocessing's yafc.lua was written for YAFC's lenient Lua crawler; the
-- real engine validates prototypes. Patch up anything it left incomplete.
-- This mod is dump-only: never play with it enabled.

local UNKNOWN = "__core__/graphics/icons/unknown.png"

local hb = data.raw.item["hidden-beacon-turd"]
if hb and not hb.stack_size then hb.stack_size = 1 end

-- an item prototype exists for a name in any item-subtype table?
local function find_item(name)
    for type_name, protos in pairs(data.raw) do
        local t = protos[name]
        if t and (type_name == "fluid" or t.stack_size or t.type == "module" or t.type == "tool" or t.type == "item") then
            return t
        end
    end
    return nil
end

-- yafc.lua creates TURD module recipes with the 1.x \`result =\` syntax
for _, r in pairs(data.raw.recipe) do
    if r.result then
        r.results = {{type = "item", name = r.result, amount = r.result_count or 1}}
        r.result = nil
        r.result_count = nil
    end
end

-- yafc.lua sets 1.x-style autoplace = {control = "..."} on farmable resources
for _, res in pairs(data.raw.resource) do
    local ap = res.autoplace
    if ap and not ap.probability_expression then
        ap.probability_expression = 1
        ap.richness_expression = ap.richness_expression or 1
    end
end

-- yafc.lua gives harvester/collector an empty fluid box ("enough for YAFC")
for _, d in pairs(data.raw["mining-drill"]) do
    local fb = d.input_fluid_box
    if fb and not fb.volume then
        fb.volume = 1000
        fb.pipe_connections = fb.pipe_connections or {}
    end
end

-- recipes the engine can't derive an icon for must declare one explicitly
for _, r in pairs(data.raw.recipe) do
    if not r.icon and not r.icons then
        local result_name = r.main_product
        if not result_name and r.results then
            local first = r.results[1]
            if first then result_name = first.name or first[1] end
        end
        local target = result_name and find_item(result_name)
        if not target or (not target.icon and not target.icons) then
            r.icon = UNKNOWN
            r.icon_size = 64
        end
    end
end

-- items created without icons (yafc helper items)
for _, tbl in pairs {data.raw.item, data.raw.module, data.raw.tool} do
    if tbl then
        for _, it in pairs(tbl) do
            if not it.icon and not it.icons then
                it.icon = UNKNOWN
                it.icon_size = 64
            end
        end
    end
end

-- yafc.lua occasionally fabricates recipes whose result item never got created
-- (a naming bug only visible under real engine validation). Drop them, then
-- scrub technology unlock effects that point at now-missing recipes.
local function item_or_fluid_exists(kind, name)
    if kind == "fluid" then return data.raw.fluid[name] ~= nil end
    return find_item(name) ~= nil
end
local dropped = {}
for name, r in pairs(data.raw.recipe) do
    local ok = true
    for _, res in pairs(r.results or {}) do
        local rname = res.name or res[1]
        local rkind = res.type or "item"
        if rname and not item_or_fluid_exists(rkind, rname) then ok = false end
    end
    if not ok then
        dropped[name] = true
        data.raw.recipe[name] = nil
        log("pyops-dump: dropped invalid recipe " .. name)
    end
end
for _, tech in pairs(data.raw.technology) do
    if tech.effects then
        for i = #tech.effects, 1, -1 do
            local eff = tech.effects[i]
            if eff.type == "unlock-recipe" and (dropped[eff.recipe] or not data.raw.recipe[eff.recipe]) then
                table.remove(tech.effects, i)
            end
        end
    end
end

-- pyalienlife's slaughterhouse.lua builds its TURD effect list imperatively
-- inside "if data and not yafc_turd_integration", so the integration's second
-- pass sees EMPTY sub-tech effects and the -laser/-music/-lard variants lose
-- their unlock mapping. Rebuild it: each sub-tech unlocks every recipe that is
-- <existing recipe>-<its suffix>.
local slaughter_paths = {
    ["laser-cutting"] = "-laser",
    ["mercy-killing"] = "-music",
    ["lard-machine"] = "-lard",
}
-- recipe-replacement pairs per sub-tech, exported through the dump as mod-data
-- so the planner can demote superseded base recipes once a path is selected
local turd_replacements = {}
for tech_name, suffix in pairs(slaughter_paths) do
    local tech = data.raw.technology[tech_name]
    if tech and (not tech.effects or #tech.effects == 0) then
        tech.effects = tech.effects or {}
        for rname in pairs(data.raw.recipe) do
            local base = rname:sub(1, -(#suffix + 1))
            if rname:sub(-#suffix) == suffix and data.raw.recipe[base] then
                table.insert(tech.effects, {type = "unlock-recipe", recipe = rname})
                table.insert(turd_replacements, {sub = tech_name, old = base, new = rname})
            end
        end
        log("pyops-dump: rebuilt " .. #tech.effects .. " unlocks for " .. tech_name)
    end
end

-- declarative upgrade files carry their replacements directly; harvest them
if mods["pyalienlife"] then
    local ok, turd = pcall(require, "__pyalienlife__/prototypes/turd")
    if ok and turd then
        local tech_upgrades = turd[1] or turd
        for _, up in pairs(tech_upgrades) do
            for _, sub in pairs(up.sub_techs or {}) do
                for _, eff in pairs(sub.effects or {}) do
                    if eff.type == "recipe-replacement" and eff.old and eff.new then
                        table.insert(turd_replacements, {sub = sub.name, old = eff.old, new = eff.new})
                    end
                end
            end
        end
    end
end
if #turd_replacements > 0 then
    data:extend {{type = "mod-data", name = "pyops-turd-replacements", data = {replacements = turd_replacements}}}
    log("pyops-dump: exported " .. #turd_replacements .. " TURD recipe replacements")
end
`;

export async function writeHelperMod() {
  const dir = join(MODS_DIR, "pyops-dump");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "info.json"), JSON.stringify(HELPER_INFO, null, 2));
  await writeFile(join(dir, "data.lua"), HELPER_DATA_LUA);
  await writeFile(join(dir, "data-final-fixes.lua"), HELPER_FINAL_FIXES_LUA);
}

type ModList = { mods: { name: string; enabled: boolean; version?: string }[] };

async function readModList(): Promise<ModList> {
  return JSON.parse(await readFile(join(MODS_DIR, "mod-list.json"), "utf8")) as ModList;
}

async function setHelperEnabled(enabled: boolean) {
  const ml = await readModList();
  const entry = ml.mods.find((m) => m.name === "pyops-dump");
  if (entry) entry.enabled = enabled;
  else ml.mods.push({ name: "pyops-dump", enabled });
  await writeFile(join(MODS_DIR, "mod-list.json"), JSON.stringify(ml, null, 2));
}

/** Fingerprint of the enabled mod set (sans the dump helper) — the version of
 * the reference data. Stored in meta + on blocks when they're solved. */
export async function modListFingerprint(): Promise<string> {
  const ml = await readModList();
  const names = ml.mods
    .filter((m) => m.enabled && m.name !== "pyops-dump")
    .map((m) => m.name)
    .sort();
  return createHash("sha256").update(names.join("\n")).digest("hex").slice(0, 16);
}

export type ModEntry = { name: string; enabled: boolean; version: string | null };

/** Map mod name → version from raw mods-directory entries (`name_x.y.z` and
 * `name_x.y.z.zip`, packed or unpacked). Mod names may contain underscores, so the
 * version is the trailing `_x.y.z`; the greedy prefix keeps the rest as the name
 * (e.g. `auto_manual_mode_0.0.11.zip` → `auto_manual_mode` @ `0.0.11`). */
export function modVersionsFromEntries(entries: string[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const entry of entries) {
    const m = /^(.+)_(\d+\.\d+\.\d+)(?:\.zip)?$/.exec(entry);
    if (m) versions.set(m[1], m[2]);
  }
  return versions;
}

/** The full mod set the reference data was dumped from: each mod's name, enabled
 * state, and version. `mod-list.json` carries only name + enabled, so versions are
 * recovered from the mods directory (`name_x.y.z(.zip)` entries). Base-game mods
 * that live in the Factorio install rather than the mods dir get a null version.
 * The pyops-dump helper is excluded — it's our dump-time tool, not real data.
 * Persisted per project so drift detection (#27) and rename capture (#26) have a
 * concrete previous state to diff against, not just a hash. */
export async function readMods(): Promise<ModEntry[]> {
  const ml = await readModList();
  let versions = new Map<string, string>();
  try {
    versions = modVersionsFromEntries(await readdir(MODS_DIR));
  } catch {
    /* mods dir missing — versions stay null */
  }
  return ml.mods
    .filter((m) => m.name !== "pyops-dump")
    .map((m) => ({ name: m.name, enabled: m.enabled, version: versions.get(m.name) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ModDrift = {
  added: ModEntry[]; // present now, absent from the baseline
  removed: ModEntry[]; // in the baseline, gone now
  enabled: string[]; // present in both, toggled off → on
  disabled: string[]; // present in both, toggled on → off
  versionChanged: { name: string; from: string | null; to: string | null }[];
};

/** Compare a persisted baseline mod set against the current one. `added`/`removed`
 * are by name; `enabled`/`disabled` are mods present in both whose enabled flag
 * flipped; `versionChanged` are mods present in both whose version differs. Pure —
 * the server supplies the two lists (baseline from meta, current from readMods). */
export function diffMods(baseline: ModEntry[], current: ModEntry[]): ModDrift {
  const base = new Map(baseline.map((m) => [m.name, m]));
  const cur = new Map(current.map((m) => [m.name, m]));
  const enabled: string[] = [];
  const disabled: string[] = [];
  const versionChanged: ModDrift["versionChanged"] = [];
  for (const [name, b] of base) {
    const c = cur.get(name);
    if (!c) continue;
    if (b.enabled !== c.enabled) (c.enabled ? enabled : disabled).push(name);
    if ((b.version ?? null) !== (c.version ?? null))
      versionChanged.push({ name, from: b.version, to: c.version });
  }
  const byName = (a: ModEntry, b: ModEntry) => a.name.localeCompare(b.name);
  return {
    added: current.filter((m) => !base.has(m.name)).sort(byName),
    removed: baseline.filter((m) => !cur.has(m.name)).sort(byName),
    enabled: enabled.sort(),
    disabled: disabled.sort(),
    versionChanged: versionChanged.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Whether the change set actually requires a re-dump. The reference data only
 * reflects the ENABLED mods and their versions, so disabled-mod churn is noise:
 * true exactly when the {enabled mod name → version} map differs. Drives the
 * "your data no longer matches the game" prompt, while `diffMods` drives display. */
export function redumpNeeded(baseline: ModEntry[], current: ModEntry[]): boolean {
  const sig = (mods: ModEntry[]) =>
    JSON.stringify(
      mods
        .filter((m) => m.enabled)
        .map((m) => [m.name, m.version ?? null] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
  return sig(baseline) !== sig(current);
}

/** Apply newly-present mod migrations (#26) to saved blocks as part of the dump.
 * The FIRST run records the current migration files as a baseline and applies
 * nothing — existing blocks already reference current names — so this is safe to
 * land without rewriting anyone's blocks. After that, only files not seen before
 * (a mod update's new rename file) are applied, in filename order so chained
 * renames compose. Renamed blocks keep their cached I/O (the normal recompute
 * refreshes it); whatever genuinely vanished falls through to the broken-block
 * handling (#1). Defensive: a read failure is logged, never thrown. */
async function applyModMigrations(): Promise<{
  firstRun: boolean;
  newFiles: number;
  blocksChanged: number;
  renames: number;
}> {
  const { readModMigrations, applyRenames } = await import("./migrations.ts");
  const mods = await readMods();
  const files = await readModMigrations(MODS_DIR, mods);
  const allKeys = files.map((f) => f.key);

  const { db } = await import("../db/index.ts");
  const { meta } = await import("../db/schema.ts");
  const writeApplied = (keys: string[]) =>
    db
      .insert(meta)
      .values({ key: "migrations_applied", value: JSON.stringify(keys) })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } })
      .run();

  const row = db.select().from(meta).where(eq(meta.key, "migrations_applied")).get();
  if (!row?.value) {
    writeApplied(allKeys); // baseline only — nothing applied on first run
    return { firstRun: true, newFiles: 0, blocksChanged: 0, renames: 0 };
  }
  let applied: Set<string>;
  try {
    applied = new Set(JSON.parse(row.value) as string[]);
  } catch {
    applied = new Set();
  }
  const newFiles = files
    .filter((f) => !applied.has(f.key))
    .sort((a, b) => a.file.localeCompare(b.file));

  let blocksChanged = 0;
  let renames = 0;
  if (newFiles.length) {
    const q = await import("../db/queries.ts");
    for (const b of q.listBlocks()) {
      const rowB = q.getBlock(b.id);
      if (!rowB) continue;
      let shape = {
        data: rowB.data as import("../db/schema.ts").BlockData,
        iconKind: rowB.iconKind,
        iconName: rowB.iconName,
      };
      let changed = false;
      for (const f of newFiles) {
        const res = applyRenames(shape, f.renames);
        if (res.changed) {
          changed = true;
          renames += res.applied.length;
        }
        shape = res.block;
      }
      if (changed) {
        // rename the input doc + icon, preserve the cached flows/power (null flows)
        q.saveBlockRow(
          {
            id: b.id,
            name: rowB.name,
            iconKind: shape.iconKind,
            iconName: shape.iconName,
            data: shape.data,
            electricityW: null,
            dataFingerprint: rowB.dataFingerprint,
          },
          null,
          null,
        );
        blocksChanged++;
      }
    }
  }
  writeApplied([...new Set([...applied, ...allKeys])]);
  return { firstRun: false, newFiles: newFiles.length, blocksChanged, renames };
}

/* ── pipeline ────────────────────────────────────────────────────────────────── */

export type SyncPhase =
  | "idle"
  | "helper-mod"
  | "dump-data"
  | "dump-locale"
  | "dump-icons"
  | "import"
  | "atlas"
  | "costs"
  | "migrations"
  | "done"
  | "error";

export type SyncState = {
  phase: SyncPhase;
  failedAt: SyncPhase | null; // which step was running when it errored (for the stepper)
  startedAt: number | null;
  finishedAt: number | null;
  log: string[];
  error: string | null;
};

const state: SyncState = {
  phase: "idle",
  failedAt: null,
  startedAt: null,
  finishedAt: null,
  log: [],
  error: null,
};

export function syncState(): SyncState {
  return state;
}

function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string } = {},
) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? APP_DIR,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(out);
      else reject(new Error(`${cmd} ${args[0] ?? ""} exited ${code}:\n${out.slice(-2000)}`));
    });
  });
}

const factorioEnv = { SteamAppId: "427520", SteamGameId: "427520" }; // lets the Steam build run headless

async function factorio(flag: string) {
  const out = await run(FACTORIO_BIN, [flag], { env: factorioEnv });
  // factorio exits 0 even when the data stage failed — check for its error banner
  if (/^-+ Error -+$/m.test(out)) {
    const m = /Error[^\n]*\n([^\n]+)/.exec(out);
    throw new Error(`factorio ${flag} failed: ${m?.[1] ?? "see log"}`);
  }
  return out;
}

const step = (phase: SyncPhase, msg: string) => {
  state.phase = phase;
  state.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
};

/** Kick off the full sync. Returns immediately; poll syncState().
 * `icons: false` skips --dump-icon-sprites + atlas rebuild — that stage loads
 * the FULL game (renderer, GPU atlases) and Steam may ask for launch
 * confirmation; data + locale dump headlessly in seconds. Re-dump icons only
 * when the mod set's visuals changed. */
export function startDataSync(opts: { icons?: boolean } = {}): SyncState {
  const icons = opts.icons ?? false;
  if (state.phase !== "idle" && state.phase !== "done" && state.phase !== "error") return state;
  state.phase = "helper-mod";
  state.failedAt = null;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.log = [];
  state.error = null;

  void (async () => {
    try {
      step("helper-mod", "writing pyops-dump helper mod + enabling it");
      await writeHelperMod();
      await setHelperEnabled(true);
      try {
        step("dump-data", "factorio --dump-data (with planner integration)");
        await factorio("--dump-data");
        step("dump-locale", "factorio --dump-prototype-locale");
        await factorio("--dump-prototype-locale");
        if (icons) {
          step("dump-icons", "factorio --dump-icon-sprites (loads the full game)");
          await factorio("--dump-icon-sprites");
        }
      } finally {
        // never leave the dump helper enabled for normal play
        await setHelperEnabled(false);
        state.log.push("pyops-dump disabled again");
      }
      step("import", "importing dump into sqlite");
      // in-process: the server already runs TS — no child process needed
      const { importFactorioDump } = await import("../db/import-factorio.ts");
      const { currentDatabaseFile } = await import("../db/index.ts");
      const summary = importFactorioDump({ dbUrl: currentDatabaseFile() });
      state.log.push(
        `imported ${summary.counts.recipes} recipes / ${summary.counts.items} items in ${summary.ms}ms`,
      );
      if (icons) {
        step("atlas", "rebuilding icon atlas");
        await run("node", [ATLAS_SCRIPT, SCRIPT_OUTPUT, ICON_DATA]);
      }

      step("costs", "computing cost analysis (LP)");
      const { computeCostAnalysis } = await import("./cost-analysis.ts");
      const costs = await computeCostAnalysis(currentDatabaseFile());
      state.log.push(`priced ${costs.goods} goods / ${costs.recipes} recipes in ${costs.ms}ms`);

      // Auto-apply any newly-present mod prototype renames to saved blocks, so a
      // pure rename follows through instead of leaving blocks broken (#26).
      step("migrations", "applying mod prototype renames");
      const mig = await applyModMigrations();
      state.log.push(
        mig.firstRun
          ? "migrations: baseline recorded (no renames applied on first sync)"
          : `migrations: ${mig.newFiles} new file(s) → ${mig.blocksChanged} block(s) renamed (${mig.renames} substitutions)`,
      );

      const fp = await modListFingerprint();
      const mods = await readMods();
      const { db } = await import("../db/index.ts");
      const { meta } = await import("../db/schema.ts");
      db.insert(meta)
        .values([
          { key: "data_fingerprint", value: fp },
          // full provenance: name + version + enabled for every mod (see readMods)
          { key: "mod_list", value: JSON.stringify(mods) },
          { key: "synced_at", value: new Date().toISOString() },
        ])
        .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } })
        .run();
      state.log.push(`recorded ${mods.length} mods`);
      step("done", `sync complete (fingerprint ${fp})`);
      state.finishedAt = Date.now();
    } catch (e) {
      state.failedAt = state.phase; // the step that was running when it broke
      state.phase = "error";
      state.error = e instanceof Error ? e.message : String(e);
      state.log.push(`ERROR: ${state.error}`);
      state.finishedAt = Date.now();
    }
  })();

  return state;
}
