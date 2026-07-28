/**
 * The science-consumer block: a singleton lab bank per project.
 *
 * Singleton on purpose. A factory has one research demand, and splitting it
 * across several blocks would make the pack rates ambiguous — you could not tell
 * whether two blocks meant two lab banks or the same one counted twice.
 *
 * Everything here reads the `labs` table and the ordinary module/beacon config,
 * so it works for any mod that has labs. Pyanodons only shows up in that its
 * vatbrains happen to be a beacon.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.server.ts";
import { blocks, fluids, items, labs, technologies, techIngredients } from "../db/schema.ts";
import type { ScienceBank } from "../db/schema.ts";
import * as q from "../db/queries.server.ts";
import {
  computeScienceBank,
  ratesForTech,
  type LabProto,
  type ScienceBankResult,
  type TechCost,
} from "./science-bank.ts";

/** Default when a bank has never been configured: Factorio's own convention of
 * one pack per unit over a 60s unit. Replaced the moment a technology is used to
 * derive rates. */
const DEFAULT_LAB_SECONDS_PER_PACK = 60;

export type LabOption = LabProto & {
  display: string | null;
  /** Localized names for the packs this lab accepts. User-facing text must never
   * show an internal name. */
  inputDisplays: Record<string, string | null>;
};

/** Localized names for goods, so no user-facing text shows an internal name. */
function displaysFor(names: string[]): Record<string, string | null> {
  const uniq = [...new Set(names)];
  if (!uniq.length) return {};
  const out: Record<string, string | null> = {};
  for (const row of db
    .select({ name: items.name, display: items.display })
    .from(items)
    .where(inArray(items.name, uniq))
    .all())
    out[row.name] = row.display;
  for (const row of db
    .select({ name: fluids.name, display: fluids.display })
    .from(fluids)
    .where(inArray(fluids.name, uniq))
    .all())
    out[row.name] ??= row.display;
  return out;
}

/** Every lab a plan can choose, cheapest research speed first. */
export function labOptions(): LabOption[] {
  return db
    .select()
    .from(labs)
    .orderBy(asc(labs.researchingSpeed))
    .all()
    .filter((l) => !l.hidden && !q.isExcluded(l.name))
    .map((l) => ({
      name: l.name,
      display: l.display,
      inputDisplays: displaysFor(l.inputs ?? []),
      researchingSpeed: l.researchingSpeed,
      moduleSlots: l.moduleSlots,
      energyUsageW: l.energyUsageW,
      allowedEffects: l.allowedEffects,
      allowedModuleCategories: l.allowedModuleCategories,
      inputs: l.inputs,
    }));
}

export type TechOption = TechCost & { name: string; display: string | null };

/** Technologies that cost science, for the derive-from-a-technology helper.
 * Trigger technologies are excluded: they are researched by doing something and
 * consume no packs, so they cannot imply a rate. */
export function techCosts(): TechOption[] {
  const byTech = new Map<string, Record<string, number>>();
  for (const row of db.select().from(techIngredients).all()) {
    const cur = byTech.get(row.technology) ?? {};
    cur[row.name] = row.amount;
    byTech.set(row.technology, cur);
  }
  return db
    .select()
    .from(technologies)
    .all()
    .flatMap((t) => {
      const ratio = byTech.get(t.name);
      if (!ratio || t.unitCount == null || t.unitTime == null) return [];
      return [
        {
          name: t.name,
          display: t.display,
          ratio,
          unitTime: t.unitTime,
          unitCount: t.unitCount,
        },
      ];
    })
    .sort((a, b) => (a.display ?? a.name).localeCompare(b.display ?? b.name));
}

/** Rates to type into the bank so a technology finishes in `minutes`. */
export function ratesForTechIn(techName: string, minutes: number) {
  const tech = techCosts().find((t) => t.name === techName);
  if (!tech) return null;
  return { tech, ...ratesForTech(tech, Math.max(1, minutes) * 60) };
}

/** The project's science block, if one exists. */
export function scienceBlock(): { id: number; name: string; bank: ScienceBank } | null {
  for (const row of db.select().from(blocks).all()) {
    const bank = (row.data as { science?: ScienceBank })?.science;
    if (bank) return { id: row.id, name: row.name, bank };
  }
  return null;
}

const emptyBank = (lab: string): ScienceBank => ({
  lab,
  packs: {},
  labSecondsPerPack: DEFAULT_LAB_SECONDS_PER_PACK,
});

/** Create the science block, or return the existing one — there is only ever
 * one, so this is the whole creation flow. */
export function ensureScienceBlock(name = "Science"): { id: number; created: boolean } {
  const existing = scienceBlock();
  if (existing) return { id: existing.id, created: false };
  const lab = labOptions()[0]?.name;
  if (!lab) throw new Error("No lab prototype found — sync the game data first.");
  const id = db
    .insert(blocks)
    .values({ name, data: { goals: [], recipes: [], science: emptyBank(lab) } })
    .returning({ id: blocks.id })
    .get().id;
  return { id, created: true };
}

/** Replace the bank on the science block. */
export function saveScienceBank(id: number, bank: ScienceBank): void {
  const row = db.select().from(blocks).where(eq(blocks.id, id)).get();
  if (!row) throw new Error(`No block ${id}`);
  const data = { ...(row.data as object), goals: [], recipes: [], science: bank };
  db.update(blocks)
    .set({ data: data as never, updatedAt: new Date() })
    .where(eq(blocks.id, id))
    .run();
}

/** Solve the bank: labs, beacon buildings, pack demand, upkeep and power. */
export function solveScienceBank(bank: ScienceBank): ScienceBankResult | null {
  const lab = labOptions().find((l) => l.name === bank.lab);
  if (!lab) return null;
  const beacons = bank.beacons ?? [];
  const moduleNames = [...(bank.modules ?? []), ...beacons.flatMap((b) => b.modules)];
  return computeScienceBank({
    lab,
    packs: bank.packs,
    labSecondsPerPack: bank.labSecondsPerPack || DEFAULT_LAB_SECONDS_PER_PACK,
    modules: bank.modules ?? [],
    beacons,
    moduleDb: q.getModules(moduleNames),
    beaconDb: q.getBeacons(beacons.map((b) => b.beacon)),
    upkeepDb: new Map(
      [...q.getBeaconUpkeep(beacons.map((b) => b.beacon))].map(([key, u]) => [
        key,
        { item: u.item, kind: u.kind, perSec: u.perSec },
      ]),
    ),
    upkeepKey: q.upkeepKey,
  });
}
