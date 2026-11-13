/** One recipe as the "what differs" labeler sees it. */
export type RecipeVariant = {
  name: string;
  /** localized display name — recipes sharing it are told apart */
  display: string | null;
  /** localized ingredient names, in recipe order */
  inputs: readonly string[];
  /** localized name of a machine that runs it (its category's base machine) */
  machine?: string | null;
};

/** Most inputs a label names before it stops ("from A + B + C"). */
const MAX_INPUTS = 3;

/**
 * Short labels that tell apart recipes sharing a display name (Py has ~800 such
 * groups: six "Iron plate", nine "Iron ore", …). Each label names only what
 * differs from its look-alikes:
 *
 * 1. the first input that some look-alike lacks ("from Molten iron"),
 * 2. then the inputs that rule out the most remaining look-alikes
 *    ("from Molten iron + Hot air"), up to MAX_INPUTS,
 * 3. then the machine, when inputs alone can't separate it (tiered powerplants
 *    burning the same fuel).
 *
 * Returns a label only for recipes whose name repeats and that something
 * distinguishes; everything else is absent from the map. Inputs a recipe has
 * in common with everything are never named, so the label stays one short line.
 */
export function recipeDifferences(recipes: readonly RecipeVariant[]): Map<string, string> {
  const groups = new Map<string, RecipeVariant[]>();
  for (const r of recipes) {
    if (!r.display) continue;
    const g = groups.get(r.display);
    if (g) g.push(r);
    else groups.set(r.display, [r]);
  }

  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const recipe of group) {
      const label = labelFor(
        recipe,
        group.filter((r) => r !== recipe),
      );
      if (label) out.set(recipe.name, label);
    }
  }
  return out;
}

function labelFor(recipe: RecipeVariant, lookAlikes: RecipeVariant[]): string | null {
  const inputs = [...new Set(recipe.inputs)];
  const picked: string[] = [];
  let rivals = lookAlikes;
  const ruledOut = (input: string) => rivals.filter((r) => !r.inputs.includes(input)).length;
  const keep = (input: string) => {
    picked.push(input);
    rivals = rivals.filter((r) => r.inputs.includes(input));
  };

  // the main input: the first one that sets this recipe apart at all
  const main = inputs.find((input) => ruledOut(input) > 0);
  if (main) keep(main);
  while (main && rivals.length > 0 && picked.length < MAX_INPUTS) {
    let best: string | null = null;
    let bestCount = 0;
    for (const input of inputs) {
      if (picked.includes(input)) continue;
      const n = ruledOut(input);
      if (n > bestCount) [best, bestCount] = [input, n];
    }
    if (!best) break;
    keep(best);
  }

  const parts = picked.length ? [`from ${picked.join(" + ")}`] : [];
  if (rivals.length > 0 && recipe.machine && rivals.some((r) => r.machine !== recipe.machine))
    parts.push(recipe.machine);
  return parts.length ? parts.join(" · ") : null;
}
