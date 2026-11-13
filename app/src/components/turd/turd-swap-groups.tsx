import { Timer } from "lucide-react";
import { Icon } from "#/lib/icons.tsx";
import { RecipeDiffHover } from "#/lib/recipe-card.tsx";
import { formatQty } from "#/lib/format.ts";
import { groupSwaps, lineIsGood, type MergedLine } from "#/lib/turd-swaps.ts";
import type { TurdBoardChange } from "#/server/turd-board.server.ts";

type RateBonus = { speed: number; prod: number };

const range = ([lo, hi]: [number, number]) =>
  lo === hi ? formatQty(lo) : `${formatQty(lo)}–${formatQty(hi)}`;
const pct = (r: number) => `${r > 1 ? "+" : "−"}${Math.round(Math.abs(r - 1) * 100)}%`;
const single = (r: [number, number]) => r[0] === r[1];

/** "100s → 75s" when every swap in the group agrees, else the relative change. */
function lineText(l: MergedLine) {
  const unit = l.kind === "time" ? "s" : "";
  const name = l.good?.display;
  if (l.a[1] === 0) return [`+${range(l.b)}${unit}`, name].filter(Boolean).join(" ");
  if (l.b[1] === 0) return [`−${range(l.a)}${unit}`, name].filter(Boolean).join(" ");
  const [lo, hi] = l.ratio!;
  const change =
    single(l.a) && single(l.b)
      ? `${formatQty(l.a[0])}${unit} → ${formatQty(l.b[0])}${unit}`
      : lo === hi
        ? pct(lo)
        : `${pct(lo)} to ${pct(hi)}`;
  return [name, change].filter(Boolean).join(" ");
}

/** A choice's recipe swaps, collapsed: one header per group of same-named swaps
 * (tiers of one creature/crop/building), then what changes. Hover a recipe icon
 * for its full before/after diff. */
export function TurdSwapGroups({
  changes,
  bonus,
}: {
  changes: TurdBoardChange[];
  bonus: RateBonus | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      {groupSwaps(changes).map((g) => (
        <div key={`${g.label}:${g.changes[0]!.to}`} className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold" title={g.label}>
              {g.label}
            </span>
            {g.changes.length > 1 && (
              <span className="text-muted-foreground">×{g.changes.length}</span>
            )}
            <span className="flex flex-wrap items-center gap-0.5">
              {g.changes.map((c) => (
                <RecipeDiffHover
                  key={c.to}
                  a={c.from!}
                  b={c.to}
                  // the module boosts what the building RUNS, not its own build recipe
                  bonus={c.buildsBuilding ? undefined : bonus}
                  className="cursor-help"
                >
                  <Icon kind="recipe" name={c.to} size="sm" noHover />
                </RecipeDiffHover>
              ))}
            </span>
          </div>
          {g.lines.map((l) => (
            <div
              key={`${l.kind}:${l.good?.kind}:${l.good?.name}`}
              className={`flex min-w-0 items-center gap-1.5 ${lineIsGood(l) ? "text-success" : "text-warning"}`}
            >
              {l.good ? (
                <Icon
                  kind={l.good.kind === "fluid" ? "fluid" : "item"}
                  name={l.good.name}
                  size="xs"
                />
              ) : (
                <Timer className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{lineText(l)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
