import type { LpBlockInput, RecipeDef } from "./lp.ts";

/**
 * v1 → v2 input mapping (#91): derive the gesture-based model from a block's
 * legacy disposition state, per the migration rules pinned on the issue:
 *
 *   - items the v1 solver auto-balanced (produced AND consumed in-block, no
 *     override) → `made` (net ≥ 0; the strictness they had, minus the
 *     forced-exactness that made Py byproducts infeasible)
 *   - `balance` overrides → `made` (what the override was protecting is now
 *     the default everywhere)
 *   - `import` / `export` overrides → absent from `made` (they were two labels
 *     for one behavior: unlink the item)
 *   - produce goals are implicitly made; SINK goals (negative rate) pass
 *     through as consume goals.
 *
 * Pure and deterministic so the same mapping serves the one-off data
 * migration, the side-by-side parity report, and unit tests.
 */

export type V1Disposition = "balance" | "export" | "import";
/** Alias kept for the doc/schema layer (the legacy field's value type). */
export type Disposition = V1Disposition;

export function migrateToLpInput(v1: {
  targets: { name: string; rate: number }[];
  recipes: RecipeDef[];
  dispositions?: Record<string, V1Disposition>;
}): LpBlockInput {
  const dispositions = v1.dispositions ?? {};
  const produced = new Set<string>();
  const consumed = new Set<string>();
  for (const r of v1.recipes) {
    for (const ing of r.ingredients) consumed.add(ing.name);
    for (const p of r.products) if (p.amount > 0) produced.add(p.name);
  }

  const made = new Set<string>();
  for (const item of produced) {
    const d = dispositions[item];
    if (d === "import" || d === "export") continue; // explicitly unlinked
    if (consumed.has(item) || d === "balance") made.add(item);
  }
  // a balance override on a consumed-only item carried real intent ("this must
  // be covered in-block") — keep it, it will surface as `unmade` until a
  // producer exists, exactly the flag the user wanted
  for (const [item, d] of Object.entries(dispositions)) {
    if (d === "balance") made.add(item);
  }
  // goal items don't need a made entry (the goal constraint subsumes it)
  for (const t of v1.targets) if (t.rate >= 0) made.delete(t.name);

  return {
    goals: v1.targets.map((t) => ({ name: t.name, rate: t.rate })),
    recipes: v1.recipes,
    ...(made.size ? { made: [...made].sort((a, b) => a.localeCompare(b)) } : {}),
  };
}
