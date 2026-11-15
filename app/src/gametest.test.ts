/**
 * PyOps's production math against Factorio's own numbers. `gametest/run.ts`
 * runs each suite's mods in the real engine and commits what it measured to
 * `gametest/results/<suite>.json`: the raw prototypes the cases used, as
 * data.raw had them, and the engine's numbers. Here those raw prototypes go
 * through the real importer, and PyOps's functions must give the engine's
 * numbers. Nothing here needs Factorio. See docs/development/gametest.md.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { importFactorioDump } from "./db/import-factorio.ts";
import * as schema from "./db/schema.ts";
import { makeTestDb } from "./db/test-helpers.ts";
import { prodScaledAmount } from "./lib/productivity.ts";
import { NORMAL_QUALITY } from "./lib/quality.ts";
import { computeEffects } from "./server/effects.ts";
import { qualityEffectLookups, spoilSecondsAt } from "./server/quality-effects.ts";
import { qualityLadder, qualitySplit } from "./solver/quality.ts";

const GAMETEST = join(import.meta.dirname, "../../gametest");

/** Cases where PyOps disagrees with the engine today, with the reason. Each is
 * an open bug: its test runs as `it.fails`, so fixing PyOps fails the test
 * until the entry is removed here. */
const KNOWN_MISMATCHES: Record<string, string> = {
  "catalyst-base-productivity":
    "prodScaledAmount drops ignored_by_productivity on a recipe that disallows productivity, " +
    "but the engine keeps it under a machine's built-in productivity",
};

// The shapes gametest/mod/scenarios/engine/control.lua writes, per case kind.
type Effects = Record<"speed" | "productivity" | "consumption" | "pollution" | "quality", number>;
type MachineSetup = {
  name: string;
  machine: string;
  modules?: string[];
  module_quality?: string;
  beacons?: {
    name: string;
    count: number;
    modules: string[];
    quality?: string;
    module_quality?: string;
  }[];
};
type Measured =
  | { case: { name: string; kind: "spoil" }; ticks: Record<string, Record<string, number>> }
  | {
      case: { name: string; kind: "products" };
      recipes: Record<string, { name: string; amount: number; ignored_by_productivity: number }[]>;
    }
  | { case: MachineSetup & { kind: "effects"; recipe?: string }; effects: Effects }
  | {
      case: MachineSetup & { kind: "craft"; recipe: string };
      crafts: number;
      products: Record<string, Record<string, number>>;
      bonus_progress: number;
      effects: Effects;
    };
type Results = {
  suite: string;
  factorio: string;
  mods: Record<string, string>;
  raw: Record<string, unknown>;
  cases: (Measured | { case: { name: string; kind: string }; skipped: string })[];
};
type Lock = { factorio: string; builtin: string[]; mods: { name: string; version: string }[] };

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** Runs the real importer on a suite's raw prototypes and returns PyOps's
 * view of them. */
async function importSuite(results: Results) {
  const fx = await makeTestDb();
  fx.db.close(); // the importer opens its own connection to the file
  const dumpDir = mkdtempSync(join(tmpdir(), "pyops-gametest-"));
  const dumpPath = join(dumpDir, "data-raw-dump.json");
  writeFileSync(dumpPath, JSON.stringify(results.raw));
  importFactorioDump({ dumpPath, dbUrl: fx.file, baseVersion: results.factorio });
  const sqlite = new Database(fx.file, { readonly: true });
  const db = drizzle(sqlite, { schema });
  const byName = <T extends { name: string }>(rows: T[]) => new Map(rows.map((r) => [r.name, r]));

  const qualities = db.select().from(schema.qualities).all();
  const meta = Object.fromEntries(
    db
      .select()
      .from(schema.meta)
      .all()
      .map((r) => [r.key, r.value]),
  );
  const bonusesOf = (quality: string | undefined) =>
    quality && quality !== NORMAL_QUALITY
      ? (qualities.find((q) => q.name === quality) ?? null)
      : null;
  const lookups = qualityEffectLookups(
    byName(db.select().from(schema.modules).all()),
    byName(db.select().from(schema.beacons).all()),
    bonusesOf,
    { quality: Number(meta.quality_effect_step), module: Number(meta.module_effect_step) },
  );
  const machines = byName(db.select().from(schema.craftingMachines).all());
  const recipes = byName(db.select().from(schema.recipes).all());
  const products = db.select().from(schema.recipeProducts).all();
  const items = byName(db.select().from(schema.items).all());

  /** computeEffects for a measured machine, set up as the case built it. */
  const effects = (setup: MachineSetup, recipeName?: string) => {
    const machine = machines.get(setup.machine);
    if (!machine) throw new Error(`${setup.machine} was not imported`);
    const recipe = recipeName ? recipes.get(recipeName) : undefined;
    return computeEffects(
      recipe?.allowProductivity ?? true,
      (setup.modules ?? []).map((m) => lookups.moduleAt(m, setup.module_quality)),
      (setup.beacons ?? []).map((b) =>
        lookups.beaconConfigAt({
          beacon: b.name,
          modules: b.modules,
          count: b.count,
          quality: b.quality,
          moduleQuality: b.module_quality,
        }),
      ),
      lookups.modules,
      lookups.beacons,
      [],
      { recipeProd: 0, miningProd: 0, maxProductivity: recipe?.maximumProductivity ?? null },
      machine.effectReceiver,
      machine,
      recipe?.allowQuality ?? true,
    );
  };

  return {
    effects,
    recipe: (name: string) => recipes.get(name),
    products: (recipe: string) =>
      products.filter((p) => p.recipe === recipe).sort((a, b) => a.idx - b.idx),
    spoilTicks: (item: string) => items.get(item)?.spoilTicks ?? null,
    bonusesOf,
    ladder: qualityLadder(qualities),
    cleanup: () => {
      sqlite.close();
      fx.cleanup();
      rmSync(dumpDir, { recursive: true, force: true });
    },
  };
}
type PyOps = Awaited<ReturnType<typeof importSuite>>;

/** The engine's effects next to PyOps's, field by field: speed and consumption
 * as raw sums (the engine reports them before the 0.2× floor), productivity
 * after its clamp, pollution and quality as PyOps applies them. */
function expectEffects(engine: Effects, pyops: ReturnType<PyOps["effects"]>) {
  expect({
    speed: pyops.speedBonus,
    productivity: pyops.prodBonus,
    consumption: pyops.consBonus,
    pollution: pyops.pollutionMult - 1,
    quality: pyops.qualityBonus,
  }).toEqual({
    speed: expect.closeTo(engine.speed, 4),
    productivity: expect.closeTo(engine.productivity, 4),
    consumption: expect.closeTo(engine.consumption, 4),
    pollution: expect.closeTo(engine.pollution, 4),
    quality: expect.closeTo(engine.quality, 4),
  });
}

type Kind = Measured["case"]["kind"];
type Of<K extends Kind> = Extract<Measured, { case: { kind: K } }>;

/** One comparison per case kind. */
const checks: { [K in Kind]: (m: Of<K>, pyops: PyOps) => void } = {
  spoil({ ticks }, pyops) {
    for (const [item, byQuality] of Object.entries(ticks)) {
      const normal = pyops.spoilTicks(item);
      expect(normal).toBe(byQuality[NORMAL_QUALITY]);
      for (const [quality, engine] of Object.entries(byQuality)) {
        const pyopsTicks = spoilSecondsAt((normal ?? 0) / 60, pyops.bonusesOf(quality)) * 60;
        // the engine floors ticks × a float32 multiplier: 23399 at uncommon, not 23400
        expect(Math.abs(pyopsTicks - engine), `${item} at ${quality}`).toBeLessThanOrEqual(1);
      }
    }
  },
  products({ recipes }, pyops) {
    for (const [recipe, engine] of Object.entries(recipes)) {
      const imported = pyops.products(recipe).map((p) => ({
        name: p.name,
        amount: p.amount,
        ignored_by_productivity: p.ignoredByProductivity,
      }));
      expect(imported).toEqual(engine);
    }
  },
  effects(m, pyops) {
    expectEffects(m.effects, pyops.effects(m.case, m.case.recipe));
  },
  craft(m, pyops) {
    const fx = pyops.effects(m.case, m.case.recipe);
    expectEffects(m.effects, fx);
    const allowProd = pyops.recipe(m.case.recipe)?.allowProductivity ?? false;
    for (const p of pyops.products(m.case.recipe)) {
      const byQuality = m.products[p.name] ?? {};
      const total = Object.values(byQuality).reduce((sum, n) => sum + n, 0);
      const scaled = (mult: number) =>
        prodScaledAmount(p.amount ?? 0, mult, p.ignoredByProductivity, allowProd);
      // a part-filled productivity bar still owes its share of one bonus craft
      const owed = m.bonus_progress * (scaled(2) - scaled(1));
      expect(total + owed, `${p.name} made`).toBeCloseTo(m.crafts * scaled(fx.prodMult), 6);
      // quality rolls are random: each level's count is binomial, so it has to
      // land within 5 standard deviations of PyOps's share
      for (const { quality, share } of qualitySplit(
        pyops.ladder,
        NORMAL_QUALITY,
        fx.qualityBonus,
      )) {
        const count = byQuality[quality] ?? 0;
        const sd = Math.sqrt(total * share * (1 - share));
        expect(Math.abs(count - total * share), `${p.name} at ${quality}`).toBeLessThanOrEqual(
          5 * sd + 1e-9,
        );
      }
    }
  },
};

// TypeScript can't tie a case's kind to its handler's parameter, hence the cast.
const check = (m: Measured, pyops: PyOps) =>
  (checks[m.case.kind] as (m: Measured, pyops: PyOps) => void)(m, pyops);

for (const file of readdirSync(join(GAMETEST, "results"))) {
  const results = readJson<Results>(join(GAMETEST, "results", file));
  describe(`gametest ${results.suite}`, () => {
    let pyops: PyOps;
    beforeAll(async () => {
      pyops = await importSuite(results);
    });
    afterAll(() => pyops.cleanup());

    it("was measured with its locked mods", () => {
      const lock = readJson<Lock>(join(GAMETEST, "locks", `${results.suite}.json`));
      expect(results.mods).toEqual(
        Object.fromEntries([
          ...lock.builtin.map((name) => [name, lock.factorio]),
          ...lock.mods.map((m) => [m.name, m.version]),
        ]),
      );
    });

    for (const r of results.cases) {
      if ("skipped" in r) {
        it.skip(`${r.case.name} (${r.skipped})`, () => {});
      } else if (KNOWN_MISMATCHES[r.case.name]) {
        it.fails(`${r.case.name}, known mismatch: ${KNOWN_MISMATCHES[r.case.name]}`, () =>
          check(r, pyops));
      } else {
        it(r.case.name, () => check(r, pyops));
      }
    }
  });
}
