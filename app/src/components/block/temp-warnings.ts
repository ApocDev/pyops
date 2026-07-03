import { fmtTemp } from "../../lib/format";
import type { SolveResult } from "./solve-view.ts";

/** One chip-level temperature warning: the short tag label and the full
 * tooltip sentence(s) naming the counterpart recipe(s) and temperatures. */
export type ChipTempWarning = { label: string; title: string };

const uniq = (vals: string[]) => [...new Set(vals)];

/** Group a block's per-producer fluid-temperature warnings (#110 interim) by
 * the chips of ONE recipe row: `ingredient` keys the row's ingredient chips
 * whose fluid some in-block producer makes at an unacceptable temperature;
 * `product` keys the row's product chips whose output temperature some
 * consumer's accepted range rejects. Multiple counterpart recipes fold into
 * one tag per chip (label lists the temps/ranges, tooltip the full story). */
export function rowTempWarnings(
  warnings: SolveResult["tempWarnings"] | undefined,
  display: Record<string, string> | undefined,
  recipe: string,
): { ingredient: Map<string, ChipTempWarning>; product: Map<string, ChipTempWarning> } {
  const disp = (n: string) => display?.[n] ?? n;
  const ingredient = new Map<string, ChipTempWarning>();
  const product = new Map<string, ChipTempWarning>();
  if (!warnings?.length) return { ingredient, product };

  const asConsumer = new Map<string, SolveResult["tempWarnings"]>();
  const asProducer = new Map<string, SolveResult["tempWarnings"]>();
  for (const w of warnings) {
    if (w.consumer === recipe) asConsumer.set(w.item, [...(asConsumer.get(w.item) ?? []), w]);
    if (w.producer === recipe) asProducer.set(w.item, [...(asProducer.get(w.item) ?? []), w]);
  }
  for (const [item, ws] of asConsumer) {
    ingredient.set(item, {
      label: `gets ${uniq(ws.map((w) => fmtTemp(w.temp)!)).join(", ")}`,
      title: ws
        .map(
          (w) =>
            `${disp(w.producer)} makes ${disp(w.item)} at ${fmtTemp(w.temp)} — outside the ${w.needs} this recipe accepts. The solver pools all temperatures by name; in-game that part of the flow can't feed this machine.`,
        )
        .join("\n"),
    });
  }
  for (const [item, ws] of asProducer) {
    product.set(item, {
      label: `needs ${uniq(ws.map((w) => w.needs)).join(", ")}`,
      title: ws
        .map(
          (w) =>
            `${disp(w.consumer)} only accepts ${disp(w.item)} at ${w.needs} — this recipe makes it at ${fmtTemp(w.temp)}. The solver pools all temperatures by name; in-game this output can't feed that machine.`,
        )
        .join("\n"),
    });
  }
  return { ingredient, product };
}
