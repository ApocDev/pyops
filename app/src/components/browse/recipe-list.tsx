import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { useFilteredList } from "../../lib/use-filtered-list";
import { groupExplorerCards, isRecyclingOrVoid } from "../../lib/explorer";
import { cn } from "#/lib/utils.ts";
import { RecipeRow, type BrowseCard } from "./recipe-row.tsx";

const LIMIT = 25;
/** price-ladder scale cap, as a multiple of the good's price */
const MAX_MULTIPLE = 20;

const RECYCLED_GROUP = {
  id: "recycled",
  label: "Recycling & void",
  hint: "Recycler recipes and voids that only dispose of a good",
};

/** One ranked explorer list (#97): the recipes producing/consuming a good,
 * filtered by the shared query and grouped by research-horizon availability.
 * Consumers rank by estimated economy flow (busiest first). With `price`
 * (a producer list), rows rank by ¥ per unit of the good, cheapest first, and
 * draw a price ladder on one scale. Recycling and void recipes hide behind a
 * header toggle, off by default. */
export function RecipeList({
  title,
  cards,
  focus,
  emptyText,
  query,
  onClearQuery,
  onPick,
  price,
  className,
}: {
  title: string;
  cards: BrowseCard[];
  focus: string;
  /** what to say when NOTHING produces/consumes the good at all */
  emptyText: string;
  /** the detail pane's shared "filter recipes…" query */
  query: string;
  onClearQuery: () => void;
  onPick: (name: string) => void;
  /** producer lists: the focus good's price — turns on the price ladder */
  price?: number | null;
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showRecycled, setShowRecycled] = useState(false);
  const ladder = price !== undefined;

  const { main, recycled } = useMemo(() => {
    const main: BrowseCard[] = [];
    const recycled: BrowseCard[] = [];
    for (const c of cards) (isRecyclingOrVoid(c) ? recycled : main).push(c);
    return { main, recycled };
  }, [cards]);
  // a good only recycling/voids produce shows them outright, with no toggle
  const recycledOn = showRecycled || main.length === 0;
  const listed = useMemo(
    () => (recycledOn ? [...main, ...recycled] : main),
    [recycledOn, main, recycled],
  );

  const filtered = useFilteredList(listed, query, {
    display: (c) => c.display,
    internal: (c) => c.name,
  });
  const order = ladder ? "unit-cost" : "flow";
  const groups = useMemo(() => {
    const recycledSet = new Set(recycled);
    const kept = filtered.filter((c) => !recycledSet.has(c));
    const gone = filtered.filter((c) => recycledSet.has(c));
    return [
      ...groupExplorerCards(kept, order),
      ...(gone.length
        ? [{ ...RECYCLED_GROUP, cards: groupExplorerCards(gone, order).flatMap((g) => g.cards) }]
        : []),
    ];
  }, [filtered, recycled, order]);
  // meters and ladder bars are relative to the WHOLE listed set, so filtering
  // doesn't rescale the bars under the cursor
  const maxFlow = useMemo(() => listed.reduce((m, c) => Math.max(m, c.flow ?? 0), 0), [listed]);

  // cap the rendered rows across groups (Py goods can have 200+ consumers)
  let budget = showAll ? Infinity : LIMIT;
  const visible = groups
    .map((g) => {
      const take = Math.min(g.cards.length, Math.max(0, budget));
      budget -= take;
      return { ...g, cards: g.cards.slice(0, take) };
    })
    .filter((g) => g.cards.length > 0);
  // ladder bars share one scale, capped at MAX_MULTIPLE × the good's price:
  // burning a ¥100k item also "makes" ash, and would flatten every other bar
  const cap = price != null && price > 0 ? price * MAX_MULTIPLE : Infinity;
  const maxUnit = listed.reduce((m, c) => Math.max(m, Math.min(c.unitCost ?? 0, cap)), 0);

  return (
    <Card className={cn("self-start", className)}>
      <CardHeader className="border-b-0">
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted-foreground">{main.length || cards.length}</span>
        {main.length > 0 && recycled.length > 0 && (
          <Button
            variant="toggle"
            size="sm"
            aria-pressed={showRecycled}
            onClick={() => setShowRecycled((on) => !on)}
            className="ml-auto"
          >
            Recycling &amp; void <span className="tabular-nums">{recycled.length}</span>
          </Button>
        )}
      </CardHeader>
      {cards.length === 0 && <div className="px-3 pb-3 text-muted-foreground">{emptyText}</div>}
      {listed.length > 0 && filtered.length === 0 && (
        <FilterEmptyState className="px-3 pb-3" query={query} onClear={onClearQuery} />
      )}
      {visible.map((g) => (
        <div key={g.id}>
          <Tooltip content={g.hint}>
            <div className="flex items-baseline gap-2 border-t border-border bg-muted/40 px-3 py-1 text-sm font-medium text-muted-foreground">
              {g.label}
              <span className="font-normal">
                {groups.find((x) => x.id === g.id)?.cards.length ?? g.cards.length}
              </span>
            </div>
          </Tooltip>
          {g.cards.map((c) => (
            <RecipeRow
              key={c.name}
              card={c}
              focus={focus}
              maxFlow={maxFlow}
              onPick={onPick}
              ladder={ladder ? { price: price ?? null, max: maxUnit } : undefined}
            />
          ))}
        </div>
      ))}
      {filtered.length > LIMIT && !showAll && (
        <Button
          variant="ghost"
          onClick={() => setShowAll(true)}
          className="w-full justify-start border-t-border px-3 font-normal text-info hover:text-info"
        >
          Show all {filtered.length}…
        </Button>
      )}
    </Card>
  );
}
