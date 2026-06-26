/**
 * Additive / commodity classifier.
 *
 * Question this answers: when drafting a production chain for some target, should
 * a given input be IMPORTED (treated as a leaf — stop recursing) or BUILT (recurse
 * into a sub-chain)? Commodities — acids, gases, pressured air, solvents, water —
 * are piped in. The target's own lineage (e.g. the iron-pulp enrichment cascade)
 * is what you build.
 *
 * Signal: fan-out ubiquity. A good consumed by many recipes across the game is a
 * cross-cutting commodity; a good consumed by ~1-2 recipes is a private
 * intermediate of one chain. In Py these separate cleanly — commodities sit at
 * 14-607 consumers, intermediates at 1-2 — so a simple threshold classifies the
 * common case, with a short override list for the low-ubiquity-but-still-commodity
 * edges (diesel, xylenol). Per-block user pins (disposition imports) override this.
 */

/** Consumed by at least this many distinct recipes ⇒ treated as a commodity. */
export const ADDITIVE_CONSUMER_THRESHOLD = 10;

/** Low-ubiquity goods that are nonetheless "import, don't make" commodities. */
export const ADDITIVE_OVERRIDES = new Set<string>(["diesel", "xylenol"]);

/** Goods that look ubiquitous but should still be buildable when targeted. */
export const ADDITIVE_EXCLUDE = new Set<string>([]);

export type AdditiveVerdict = {
  additive: boolean;
  reason: string;
};

/** Classify a good given how many distinct recipes consume it (see
 * queries.goodGraphCounts). Pure — no db access, so it's trivially testable and
 * reusable by the chain-descent driver and the MCP adapter. */
export function classifyAdditive(name: string, consumers: number): AdditiveVerdict {
  if (ADDITIVE_EXCLUDE.has(name)) return { additive: false, reason: "excluded (build it)" };
  if (ADDITIVE_OVERRIDES.has(name)) return { additive: true, reason: "curated commodity" };
  if (consumers >= ADDITIVE_CONSUMER_THRESHOLD)
    return { additive: true, reason: `ubiquitous (${consumers} consumers) — import it` };
  return { additive: false, reason: `narrow (${consumers} consumers) — chain intermediate` };
}
