import { Timer } from "lucide-react";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { fmtSpoilTime } from "../../lib/icons.tsx";

type Product = {
  name: string;
  kind: string;
  display?: string | null;
};

/** Marks a recipe whose output items spoil. Spoilage belongs to the products,
 * not the recipe prototype, so the row derives this from its solved products
 * instead of teaching the shared recipe icon layer an ambiguous recipe→item
 * mapping. */
export function RecipeSpoilageIndicator({
  products,
  spoilables,
}: {
  products: readonly Product[];
  spoilables: Readonly<Record<string, number>>;
}) {
  const seen = new Set<string>();
  const entries = products.flatMap((product) => {
    const ticks = product.kind === "item" ? spoilables[product.name] : undefined;
    if (ticks == null || seen.has(product.name)) return [];
    seen.add(product.name);
    return [{ display: product.display ?? product.name, ticks }];
  });
  if (entries.length === 0) return null;

  const detail =
    entries.length === 1
      ? `Produces ${entries[0].display}, which spoils in ${fmtSpoilTime(entries[0].ticks)}`
      : `Spoilable products:\n${entries
          .map((entry) => `${entry.display} — ${fmtSpoilTime(entry.ticks)}`)
          .join("\n")}`;
  const summary = entries.length === 1 ? fmtSpoilTime(entries[0].ticks) : `${entries.length} spoil`;

  return (
    <>
      <span aria-hidden>·</span>
      <Tooltip content={detail}>
        <span
          role="img"
          tabIndex={0}
          aria-label={detail}
          data-recipe-spoilage
          className="flex shrink-0 items-center gap-1 text-sm text-warning"
        >
          <Timer className="size-3.5" />
          {summary}
        </span>
      </Tooltip>
    </>
  );
}
