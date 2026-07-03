/**
 * Factory-wide coherence audit for the planning agent (#11): the cross-block
 * balance the Coherence page shows, shaped token-economically for a tool result
 * so the agent can audit the whole factory in ONE call instead of reasoning
 * block by block.
 *
 * Reuses the same wiring query as the page (`q.factoryCoherence()`), then adds
 * the byproduct-disposal check the page doesn't have: a dangling byproduct is
 * classified by where it could go — productive consuming recipes ("route"),
 * a vent/void disposal recipe ("void"), or genuinely nowhere ("nowhere" —
 * must be stored/buffered, an open problem).
 *
 * The disposal classifier is data-driven, not name-matched: Py's `*-pyvoid`
 * incineration / `*-pyvoid-fluid` sinkhole / `*-pyvoid-gas` venting recipes all
 * consume only the good and return at most a fraction of it (e.g. `ash-pyvoid`:
 * 1 ash in → 1 ash out at probability 0.2), so the shape generalizes to any mod.
 */
import * as q from "../db/queries.server.ts";

/** Grid/local energy pseudo-goods — never balanced block-to-block (electricity is
 * grid-distributed, heat can't travel), so they'd only be noise in the audit.
 * `pyops-fluid-fuel` is NOT skipped (#115): MJ is a matched block-to-block flow. */
const AUDIT_FREE = new Set(["pyops-electricity", "pyops-heat"]);

const EPS = 1e-3;

type Component = {
  name: string;
  amount?: number | null;
  amountMin?: number | null;
  amountMax?: number | null;
  probability?: number | null;
};

const expectedAmount = (c: Component) =>
  (c.amount ?? (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0)) *
  (c.probability ?? 1);

/** True when a recipe merely DISPOSES of `good`: every ingredient is the good
 * itself and any products only return part of the same good. Matches Py's
 * venting (no products), sinkholes (no products), and incineration (a fraction
 * of the item back) without hardcoding recipe names or categories. */
export function isVoidRecipeFor(recipeName: string, good: string): boolean {
  const r = q.getRecipe(recipeName);
  if (!r) return false;
  if (!r.ingredients.length || r.ingredients.some((c) => c.name !== good)) return false;
  const inAmount = r.ingredients.reduce((s, c) => s + (c.amount ?? 0), 0);
  if (!r.products.length) return true;
  return (
    r.products.every((p) => p.name === good) &&
    r.products.reduce((s, p) => s + expectedAmount(p), 0) < inAmount
  );
}

export type Disposal = {
  /** productive consuming recipes (not voids, not barreling) */
  consumingRecipes: number;
  topConsumers: string[];
  /** vent/void disposal recipes for this good (Py: incinerate/sinkhole/vent) */
  voidRecipes: string[];
  /** route = a real consumer exists; void = only disposal; nowhere = store/buffer */
  disposal: "route" | "void" | "nowhere";
};

/** Where a byproduct could go: productive consumers vs vent/void disposal. */
export function byproductDisposal(good: string): Disposal {
  const all = q.recipesConsuming(good).filter((r) => !r.name.includes("barrel"));
  const productive: string[] = [];
  const voids: string[] = [];
  for (const r of all) (isVoidRecipeFor(r.name, good) ? voids : productive).push(r.name);
  return {
    consumingRecipes: productive.length,
    topConsumers: productive.slice(0, 3),
    voidRecipes: voids.slice(0, 2),
    disposal: productive.length ? "route" : voids.length ? "void" : "nowhere",
  };
}

type End = { blockId: number; blockName: string; rate: number; role: string };
const end = (e: End) => ({
  blockId: e.blockId,
  block: e.blockName,
  rate: +e.rate.toFixed(3),
  role: e.role,
});

/** The factory-wide audit: under-supplied goods (resize the producer), imports
 * with no producing block, dangling byproducts (with a disposal verdict), plus
 * overproduction and the intentional final products for context. */
export function coherenceAudit() {
  const { links, unsourced, surplus } = q.factoryCoherence();

  const underSupplied = links
    .filter((l) => !AUDIT_FREE.has(l.good) && l.net < -EPS)
    .map((l) => ({
      good: l.good,
      kind: l.kind,
      shortPerSec: +(-l.net).toFixed(3),
      producedPerSec: l.produced,
      consumedPerSec: l.consumed,
      producers: l.producers.map(end),
      consumers: l.consumers.map(end),
    }));

  const overProduced = links
    .filter((l) => !AUDIT_FREE.has(l.good) && l.net > EPS)
    .map((l) => ({
      good: l.good,
      surplusPerSec: +l.net.toFixed(3),
      producers: l.producers.map(end),
    }));

  const unsourcedImports = unsourced
    .filter((l) => !AUDIT_FREE.has(l.good))
    .map((l) => ({
      good: l.good,
      kind: l.kind,
      consumedPerSec: l.consumed,
      craftable: l.craftable, // a recipe exists — a block could be built
      consumers: l.consumers.map(end),
    }));

  const danglingByproducts: object[] = [];
  const finalProducts: object[] = [];
  for (const l of surplus) {
    if (AUDIT_FREE.has(l.good)) continue;
    const intentional = l.producers.some((p) => p.role === "primary" || p.role === "stock");
    if (intentional) {
      // a block's declared output nothing consumes — a final product, not waste
      finalProducts.push({ good: l.good, producedPerSec: l.produced });
    } else {
      danglingByproducts.push({
        good: l.good,
        kind: l.kind,
        producedPerSec: l.produced,
        producers: l.producers.map(end),
        ...byproductDisposal(l.good),
      });
    }
  }

  return {
    blocks: q.listBlocks().length,
    balancedLinks: links.length - underSupplied.length - overProduced.length,
    underSupplied,
    overProduced,
    unsourcedImports,
    danglingByproducts,
    finalProducts,
  };
}
