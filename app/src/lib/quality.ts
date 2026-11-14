/**
 * Quality identity (#264, #266). A good, a recipe row's run at one quality, or
 * a made mark names a (name, quality) pair. Normal quality is the bare name
 * with no qualifier, so every Py document and cache row reads exactly as it
 * did before quality existed. Any other quality is written `name@quality`.
 *
 * The same key is the solver's internal good name for that quality, so a made
 * mark like `iron-plate@rare` reaches the LP unchanged. Parsing needs the set
 * of real quality names: a name only counts as qualified when the text after
 * the last `@` is one of them.
 */

export const NORMAL_QUALITY = "normal";
const SEP = "@";

/** The key for `name` at `quality`; normal (or no quality) is the bare name. */
export function qualityKey(name: string, quality?: string | null): string {
  return quality == null || quality === NORMAL_QUALITY ? name : `${name}${SEP}${quality}`;
}

/** Splits a key into its name and quality. The quality is null at normal and
 * for any name whose suffix isn't one of `qualities`. */
export function splitQualityKey(
  key: string,
  qualities: ReadonlySet<string>,
): { name: string; quality: string | null } {
  const at = key.lastIndexOf(SEP);
  if (at <= 0) return { name: key, quality: null };
  const quality = key.slice(at + 1);
  if (quality === NORMAL_QUALITY || !qualities.has(quality)) return { name: key, quality: null };
  return { name: key.slice(0, at), quality };
}
