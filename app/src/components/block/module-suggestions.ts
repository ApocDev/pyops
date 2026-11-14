import type { SolveInput } from "../../server/factorio";

/** The module fills the server suggested for one solve, with the per-row
 * inputs they were computed from (see `suggestionInputs`). */
export type SuggestionResult = {
  inputs: Record<string, string>;
  fills: Record<string, string[]>;
};

/** One key per row covering everything the server's fill for that row reads
 * from the block: its rate, chosen machine, and its own module and beacon
 * picks (see computeModuleSuggestions). Two solves with the same key for a row
 * get the same fill for it. */
export function suggestionInputs(
  doc: Pick<SolveInput, "modules" | "beacons">,
  rows: readonly { recipe: string; rate: number; machine: string | null }[],
): Record<string, string> {
  return Object.fromEntries(
    rows.map((row) => [
      row.recipe,
      JSON.stringify([
        row.rate,
        row.machine,
        doc.modules?.[row.recipe] ?? [],
        doc.beacons?.[row.recipe] ?? [],
      ]),
    ]),
  );
}

/** The fills that apply to the current solve. A result held over from an
 * earlier solve (while the next one loads, or after it failed) keeps a row's
 * fill only while that row's inputs are unchanged, so a row whose machine or
 * modules just changed never offers the old configuration's fill. */
export function currentFills(
  result: SuggestionResult | undefined,
  inputs: Record<string, string>,
): Record<string, string[]> {
  if (!result) return {};
  return Object.fromEntries(
    Object.entries(result.fills).filter(([recipe]) => result.inputs[recipe] === inputs[recipe]),
  );
}
