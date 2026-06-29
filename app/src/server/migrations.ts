/**
 * Mod prototype-rename capture (#26). Factorio mods ship declarative migration
 * files at `migrations/*.json` mapping old prototype names to new ones per type:
 *
 *   { "recipe": [["old","new"], ...], "item": [...], "fluid": [...], "entity": [...] }
 *
 * When a mod renames a recipe/item/fluid/entity, saved blocks that reference the
 * old name should follow the rename automatically (a pure string substitution)
 * rather than appearing broken. The mod's own Lua runtime can't read other mods'
 * migration files, but the app backend can read them straight from the mod zips
 * (or unpacked folders). The `.lua` migration files are procedural save-state
 * scripts, not prototype renames, and are out of scope.
 *
 * This module is the pure + read-only layer (parse, apply, read-from-disk). The
 * dump pipeline (`dump.ts`) owns the "which files are new since last dump" diff
 * and the block writes, so the rename is applied before the user is asked to deal
 * with anything (#27); whatever genuinely disappeared falls through to the
 * graceful-degradation handling (#1).
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { BlockData } from "../db/schema.ts";
import { normalizeBlockData } from "../lib/goals.ts";
import type { ModEntry } from "./dump.ts";

/** Rename maps for the prototype types a saved block can reference. `item` and
 * `fluid` collapse into `good` (goals, dispositions, fuels, modules are all goods);
 * `entity` covers machines and beacons. */
export type Renames = {
  recipe: Map<string, string>;
  good: Map<string, string>;
  entity: Map<string, string>;
};

/** One migration file we read from a mod, with its parsed renames. `key` is the
 * stable dedupe identity (`mod/file`) used to tell new files from already-applied. */
export type MigrationFile = { mod: string; file: string; key: string; renames: Renames };

export const emptyRenames = (): Renames => ({
  recipe: new Map(),
  good: new Map(),
  entity: new Map(),
});

export const hasRenames = (r: Renames): boolean =>
  r.recipe.size > 0 || r.good.size > 0 || r.entity.size > 0;

/** Parse a Factorio migration JSON into typed rename maps. Tolerant of junk: only
 * `[string, string]` pairs under the recipe/item/fluid/entity keys are kept, and
 * identity renames (old === new) are dropped. */
export function parseMigrationJson(json: unknown): Renames {
  const r = emptyRenames();
  const into = (m: Map<string, string>, pairs: unknown) => {
    if (!Array.isArray(pairs)) return;
    for (const p of pairs)
      if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string" && p[0] !== p[1])
        m.set(p[0], p[1]);
  };
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    into(r.recipe, o.recipe);
    into(r.good, o.item);
    into(r.good, o.fluid);
    into(r.entity, o.entity);
  }
  return r;
}

/** A block's renameable surface: its config doc plus the icon kind/name (icons are
 * stored as columns, not inside BlockData). */
export type BlockShape = { data: BlockData; iconKind: string | null; iconName: string | null };

/** Apply rename maps to one block. Pure — returns a new shape and whether anything
 * matched. Recipes rename `recipes[]` and the recipe-keyed maps' keys; goods rename
 * the goal/disposition/fuel/module fields; entities rename machine + beacon names;
 * `iconName` follows its `iconKind`. */
export function applyRenames(
  block: BlockShape,
  r: Renames,
): { block: BlockShape; changed: boolean; applied: string[] } {
  const applied: string[] = [];
  const sub = (m: Map<string, string>) => (name: string) => {
    const to = m.get(name);
    if (to == null) return name;
    applied.push(`${name}→${to}`);
    return to;
  };
  const recipe = sub(r.recipe);
  const good = sub(r.good);
  const entity = sub(r.entity);
  const mapKeys = <V>(
    obj: Record<string, V> | undefined,
    keyFn: (k: string) => string,
    valFn: (v: V) => V = (v) => v,
  ): Record<string, V> | undefined =>
    obj && Object.fromEntries(Object.entries(obj).map(([k, v]) => [keyFn(k), valFn(v)]));

  const d = normalizeBlockData(block.data);
  const next: BlockData = {
    ...d,
    goals: d.goals.map((g) => ({ ...g, name: good(g.name) })),
    recipes: d.recipes.map(recipe),
    dispositions: mapKeys(d.dispositions, good),
    machines: mapKeys(d.machines, recipe, entity),
    fuels: mapKeys(d.fuels, recipe, good),
    modules: mapKeys(d.modules, recipe, (mods) => mods.map(good)),
    beacons: mapKeys(d.beacons, recipe, (cfgs) =>
      cfgs.map((b) => ({ ...b, beacon: entity(b.beacon), modules: b.modules.map(good) })),
    ),
  };

  let iconName = block.iconName;
  if (iconName)
    iconName =
      block.iconKind === "recipe"
        ? recipe(iconName)
        : block.iconKind === "item" || block.iconKind === "fluid"
          ? good(iconName)
          : iconName;

  return {
    block: { data: next, iconKind: block.iconKind, iconName },
    changed: applied.length > 0,
    applied,
  };
}

/* ── Reading migration files from the mods directory ─────────────────────────── */

const MIG_JSON = /(?:^|\/)migrations\/[^/]+\.json$/i;
const fileBase = (path: string) => path.split("/").pop() ?? path;
const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Migration JSONs inside a mod zip, by base filename. Exported for testing
 * (the dump path reads the buffer off disk first). */
export function migrationsFromZip(buf: Uint8Array): { file: string; json: unknown }[] {
  const files = unzipSync(buf, { filter: (f) => MIG_JSON.test(f.name) });
  return Object.entries(files).map(([name, data]) => ({
    file: fileBase(name),
    json: safeJson(strFromU8(data)),
  }));
}

/** Locate a mod's on-disk entry in the mods directory: a `name_version(.zip)`
 * zip/folder (zip preferred), else a bare `name` folder. Base-game mods that live
 * in the Factorio install rather than the mods dir return null (skipped). */
function modEntryOnDisk(entries: string[], mod: ModEntry): string | null {
  if (mod.version) {
    if (entries.includes(`${mod.name}_${mod.version}.zip`)) return `${mod.name}_${mod.version}.zip`;
    if (entries.includes(`${mod.name}_${mod.version}`)) return `${mod.name}_${mod.version}`;
  }
  const versioned = entries.filter((e) => e.startsWith(`${mod.name}_`));
  return (
    versioned.find((e) => e.endsWith(".zip")) ??
    versioned[0] ??
    (entries.includes(mod.name) ? mod.name : null)
  );
}

async function migrationsFromEntry(
  modsDir: string,
  entry: string,
): Promise<{ file: string; json: unknown }[]> {
  const full = join(modsDir, entry);
  if (entry.endsWith(".zip")) {
    return migrationsFromZip(new Uint8Array(await readFile(full)));
  }
  // unpacked mod folder: read migrations/*.json directly
  const migDir = join(full, "migrations");
  let names: string[];
  try {
    names = await readdir(migDir);
  } catch {
    return [];
  }
  const out: { file: string; json: unknown }[] = [];
  for (const n of names)
    if (n.toLowerCase().endsWith(".json")) {
      try {
        out.push({ file: n, json: safeJson(await readFile(join(migDir, n), "utf8")) });
      } catch {
        /* unreadable file — skip */
      }
    }
  return out;
}

/** Read every ENABLED mod's `migrations/*.json` (from its zip or unpacked folder).
 * One entry per file with its parsed renames. Fully defensive — a mod that can't
 * be read is skipped, never throwing, so a single bad zip can't fail the dump. */
export async function readModMigrations(
  modsDir: string,
  mods: ModEntry[],
): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(modsDir);
  } catch {
    return [];
  }
  const out: MigrationFile[] = [];
  for (const mod of mods) {
    if (!mod.enabled) continue;
    const entry = modEntryOnDisk(entries, mod);
    if (!entry) continue;
    try {
      for (const { file, json } of await migrationsFromEntry(modsDir, entry)) {
        const renames = parseMigrationJson(json);
        if (hasRenames(renames))
          out.push({ mod: mod.name, file, key: `${mod.name}/${file}`, renames });
      }
    } catch {
      /* unreadable mod archive — skip */
    }
  }
  return out;
}
