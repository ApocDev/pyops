/** Data for the TURD board (/turd): every TURD group with, per option, what each
 * recipe swap changes and which of the player's blocks the option touches.
 * Impact is read straight from saved blocks (their recipe sets and cached
 * machine counts), not estimated by re-solving. */
import { inArray } from "drizzle-orm";
import { db } from "../db/index.server.ts";
import { blockMachines, blocks, craftingMachines } from "../db/schema.ts";
import * as q from "../db/queries.server.ts";
import { swapLines, type RecipeSide } from "../lib/turd-swaps.ts";

/** A block an option touches: the swap recipes it runs (old or new side), and
 * the machines it runs that the option's always-on module would land in. */
export type TurdBlockHit = { id: number; name: string; recipes: string[]; machines: string[] };

export function turdBoard() {
  const upgrades = q.listTurdUpgrades();
  const changes = upgrades.flatMap((u) => u.subTechs.flatMap((s) => s.changes));
  const recipeRows = q.recipesByName(changes.flatMap((c) => (c.from ? [c.from, c.to] : [c.to])));
  const side = (name: string): RecipeSide | null => {
    const r = recipeRows.get(name);
    if (!r) return null;
    const slim = (c: { kind: string; name: string; display: string | null }, amount: number) => ({
      kind: c.kind,
      name: c.name,
      display: c.display,
      amount,
    });
    return {
      energyRequired: r.energyRequired,
      ingredients: r.ingredients.map((c) => slim(c, c.amount)),
      products: r.products.map((c) => slim(c, q.avgAmount(c) * c.probability)),
    };
  };

  const blockRows = db
    .select({ id: blocks.id, name: blocks.name, data: blocks.data })
    .from(blocks)
    .orderBy(blocks.sortOrder, blocks.name)
    .all();
  const machineRows = db
    .selectDistinct({ blockId: blockMachines.blockId, machine: blockMachines.machine })
    .from(blockMachines)
    .all();
  const machineNames = [...new Set(machineRows.map((r) => r.machine))];
  const machineInfo = new Map(
    (machineNames.length
      ? db
          .select({
            name: craftingMachines.name,
            allowedModuleCategories: craftingMachines.allowedModuleCategories,
          })
          .from(craftingMachines)
          .where(inArray(craftingMachines.name, machineNames))
          .all()
      : []
    ).map((m) => [m.name, m]),
  );
  const machinesByBlock = new Map<number, string[]>();
  for (const r of machineRows) {
    const list = machinesByBlock.get(r.blockId) ?? [];
    list.push(r.machine);
    machinesByBlock.set(r.blockId, list);
  }

  const hitsFor = (
    recipes: Set<string>,
    mods: { name: string; category: string | null }[],
  ): TurdBlockHit[] =>
    blockRows.flatMap((b) => {
      const hitRecipes = (b.data.recipes ?? []).filter((r) => recipes.has(r));
      const hitMachines = (machinesByBlock.get(b.id) ?? []).filter((m) => {
        const machine = machineInfo.get(m);
        return machine && mods.some((mod) => q.turdModuleFits(mod, machine));
      });
      return hitRecipes.length || hitMachines.length
        ? [{ id: b.id, name: b.name, recipes: hitRecipes, machines: hitMachines }]
        : [];
    });

  return upgrades.map((u) => ({
    ...u,
    subTechs: u.subTechs.map((s) => {
      const swapped = new Set(s.changes.flatMap((c) => (c.from ? [c.from, c.to] : [c.to])));
      return {
        ...s,
        changes: s.changes.map((c) => {
          const from = c.from ? side(c.from) : null;
          const to = side(c.to);
          return {
            ...c,
            // what the swap changes; for a new unlock, the recipe itself
            lines: from && to ? swapLines(from, to) : [],
            recipe: !c.from && to ? to : null,
          };
        }),
        blocks: hitsFor(swapped, s.modules),
      };
    }),
  }));
}

export type TurdBoardGroup = ReturnType<typeof turdBoard>[number];
export type TurdBoardOption = TurdBoardGroup["subTechs"][number];
export type TurdBoardChange = TurdBoardOption["changes"][number];
