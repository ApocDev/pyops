// The gametest runner: measures Factorio's own numbers for PyOps's tests.
//
//   node gametest/run.ts update [suite...]  newest mods for each suite -> locks/<suite>.json
//   node gametest/run.ts run [suite...]     engine scenario on the locked mods -> results/<suite>.json
//
// No suite names means every suite in suites.json. See
// docs/development/gametest.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = import.meta.dirname;
const HOME = os.homedir();
const FACTORIO =
  process.env.FACTORIO_BIN ??
  path.join(HOME, ".local/share/Steam/steamapps/common/Factorio/bin/x64/factorio");
const CACHE =
  process.env.PYOPS_GAMETEST_CACHE ??
  path.join(process.env.XDG_CACHE_HOME ?? path.join(HOME, ".cache"), "pyops-gametest");
const PORTAL = "https://mods.factorio.com";
// the mod portal answers downloads with 403 unless the client looks like a browser
const USER_AGENT = "Mozilla/5.0 (pyops-gametest)";
// official mods ship in the game's data dir, not on the portal
const BUILTIN = ["base", "elevated-rails", "quality", "recycler", "space-age"];
const TEST_MOD = "pyops-gametest";
const TEST_TICKS = 40_000;

type LockedMod = { name: string; version: string; file: string; sha1: string; download: string };
type Lock = { factorio: string; builtin: string[]; mods: LockedMod[] };
type Release = {
  version: string;
  file_name: string;
  sha1: string;
  download_url: string;
  released_at: string;
  info_json: { factorio_version: string; dependencies?: string[] };
};

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const sha1 = (data: Uint8Array) => createHash("sha1").update(data).digest("hex");
const lockPath = (suite: string) => path.join(ROOT, "locks", `${suite}.json`);

function gameVersion(): string {
  const out = spawnSync(FACTORIO, ["--version"], { encoding: "utf8" });
  const version = /Version: (\d+\.\d+\.\d+)/.exec(out.stdout ?? "")?.[1];
  if (!version)
    throw new Error(`could not read the game version from ${FACTORIO} (set FACTORIO_BIN)`);
  return version;
}

/** Required dependencies only: optional (?, (?)), recommended (+) and
 * incompatible (!) entries are skipped; ~ only changes load order. */
const requiredDeps = (deps: string[]) =>
  deps.flatMap((dep) => {
    const d = dep.trim();
    if (/^(!|\?|\(\?\)|\+)/.test(d)) return [];
    return [d.replace(/^~\s*/, "").split(/[\s<>=]/)[0]];
  });

/** Mod portal login as a query string, read only when a download needs it. */
function portalAuth(): string {
  let username = process.env.FACTORIO_USERNAME;
  let token = process.env.FACTORIO_TOKEN;
  if (!username || !token) {
    const file = path.join(HOME, ".factorio", "player-data.json");
    const saved = fs.existsSync(file) ? readJson<Record<string, string>>(file) : {};
    username ||= saved["service-username"];
    token ||= saved["service-token"];
  }
  if (!username || !token) {
    throw new Error("no mod portal login: set FACTORIO_USERNAME and FACTORIO_TOKEN");
  }
  return new URLSearchParams({ username, token }).toString();
}

/** The cached zip for a locked mod, downloaded and checked against its sha1. */
async function cachedZip(mod: LockedMod): Promise<string> {
  const file = path.join(CACHE, "mods", mod.file);
  if (fs.existsSync(file) && sha1(fs.readFileSync(file)) === mod.sha1) return file;
  console.log(`  downloading ${mod.file}`);
  // errors never echo the URL: it carries the token
  const res = await fetch(`${PORTAL}${mod.download}?${portalAuth()}`, {
    headers: { "User-Agent": USER_AGENT },
  }).catch(() => null);
  if (!res?.ok) throw new Error(`download of ${mod.file} failed (HTTP ${res?.status ?? "error"})`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (sha1(body) !== mod.sha1) throw new Error(`${mod.file} does not match its sha1`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, body);
  fs.renameSync(`${file}.part`, file);
  return file;
}

/** Resolves the newest release of each mod and its required dependencies for
 * the installed game, downloads them, and writes the suite's lockfile. */
async function update(suite: string, wanted: string[]) {
  const factorio = gameVersion();
  const major = factorio.split(".").slice(0, 2).join(".");
  const builtin = new Set(["base"]);
  const mods = new Map<string, LockedMod>();
  const queue = [...wanted];
  for (let name = queue.shift(); name; name = queue.shift()) {
    if (BUILTIN.includes(name)) builtin.add(name);
    if (BUILTIN.includes(name) || mods.has(name)) continue;
    const res = await fetch(`${PORTAL}/api/mods/${name}/full`);
    if (!res.ok) throw new Error(`mod portal has no ${name} (HTTP ${res.status})`);
    const { releases } = (await res.json()) as { releases: Release[] };
    const release = releases
      .filter((r) => r.info_json.factorio_version === major)
      .sort((a, b) => a.released_at.localeCompare(b.released_at))
      .at(-1);
    if (!release) throw new Error(`${name} has no release for Factorio ${major}`);
    mods.set(name, {
      name,
      version: release.version,
      file: release.file_name,
      sha1: release.sha1,
      download: release.download_url,
    });
    queue.push(...requiredDeps(release.info_json.dependencies ?? []));
  }
  const lock: Lock = {
    factorio,
    builtin: BUILTIN.filter((name) => builtin.has(name)),
    mods: [...mods.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  for (const mod of lock.mods) await cachedZip(mod);
  fs.mkdirSync(path.dirname(lockPath(suite)), { recursive: true });
  fs.writeFileSync(lockPath(suite), `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`${suite}: Factorio ${factorio}, ${lock.mods.length} portal mods locked`);
}

/** Object keys sorted at every depth, so committed results diff cleanly. */
const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sortKeys(v)]),
        )
      : value;

type CaseResult = { case: { name: string }; error?: string; skipped?: string };

/** Runs the engine scenario on a suite's locked mods in an isolated write-data
 * dir, then writes the measurements to results/<suite>.json. */
async function run(suite: string) {
  const lock = readJson<Lock>(lockPath(suite));
  const factorio = gameVersion();
  if (factorio !== lock.factorio) {
    console.warn(
      `warning: ${suite} is locked to Factorio ${lock.factorio}, installed is ${factorio}`,
    );
  }
  const dir = path.join(CACHE, "runs", suite);
  const modDir = path.join(dir, "mods");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(modDir, { recursive: true });
  for (const mod of lock.mods) fs.symlinkSync(await cachedZip(mod), path.join(modDir, mod.file));
  fs.symlinkSync(path.join(ROOT, "mod"), path.join(modDir, TEST_MOD));
  const enabled = new Set([...lock.builtin, ...lock.mods.map((m) => m.name), TEST_MOD]);
  const modList = [...BUILTIN, ...lock.mods.map((m) => m.name), TEST_MOD].map((name) => ({
    name,
    enabled: enabled.has(name),
  }));
  fs.writeFileSync(path.join(modDir, "mod-list.json"), JSON.stringify({ mods: modList }));
  const config = path.join(dir, "config.ini");
  fs.writeFileSync(config, `[path]\nread-data=__PATH__system-read-data__\nwrite-data=${dir}\n`);

  const started = Date.now();
  const game = spawnSync(
    FACTORIO,
    [
      ...["--config", config, "--mod-directory", modDir],
      ...["--test-scenario", `${TEST_MOD}/engine`],
      // the map seed also seeds quality rolls: a fixed one makes reruns identical
      ...["--map-gen-seed", "1"],
      // a backstop: the scenario finishes itself and times its own cases out
      ...["--test-ticks", String(TEST_TICKS)],
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const log = `${game.stdout ?? ""}${game.stderr ?? ""}`;
  fs.writeFileSync(path.join(dir, "factorio.log"), log);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const output = path.join(dir, "script-output", "results.json");
  if (!fs.existsSync(output)) {
    console.error(log.split("\n").slice(-30).join("\n"));
    throw new Error(
      `${suite}: Factorio exited ${game.status} without results (log: ${dir}/factorio.log)`,
    );
  }
  const results = readJson<{ raw: unknown; cases: CaseResult[] }>(output);
  console.log(`${suite}: Factorio exited ${game.status} after ${seconds}s`);
  for (const r of results.cases) {
    const state = r.error ? `ERROR ${r.error}` : r.skipped ? `skipped (${r.skipped})` : "measured";
    console.log(`  ${r.case.name}: ${state}`);
  }
  if (game.status !== 0) throw new Error(`${suite}: the scenario failed, results not written`);
  const mods = Object.fromEntries([
    ...lock.builtin.map((name) => [name, factorio]),
    ...lock.mods.map((m) => [m.name, m.version]),
  ]);
  const file = path.join(ROOT, "results", `${suite}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(sortKeys({ suite, factorio, mods, raw: results.raw, cases: results.cases }), null, 2)}\n`,
  );
}

const [command, ...names] = process.argv.slice(2);
const suites = readJson<Record<string, string[]>>(path.join(ROOT, "suites.json"));
const picked = names.length ? names : Object.keys(suites);
const unknown = picked.filter((name) => !suites[name]);
if ((command !== "update" && command !== "run") || unknown.length) {
  console.error(
    unknown.length
      ? `unknown suite: ${unknown.join(", ")}`
      : "usage: node gametest/run.ts update|run [suite...]",
  );
  process.exit(2);
}
for (const suite of picked) {
  try {
    if (command === "update") await update(suite, suites[suite]);
    else await run(suite);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
