import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { useFilteredList } from "../../lib/use-filtered-list";
import { groupExplorerCards } from "../../lib/explorer";
import { RecipeRow, type BrowseCard } from "./recipe-row.tsx";

const LIMIT = 25;

/** One ranked explorer list (#97): the recipes producing/consuming a good,
 * filtered by the shared query, grouped by research-horizon availability, and
 * ordered inside each group by estimated economy flow (busiest first). */
export function RecipeList({
  title,
  cards,
  focus,
  emptyText,
  query,
  onClearQuery,
  onPick,
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
}) {
  const [showAll, setShowAll] = useState(false);
  const filtered = useFilteredList(cards, query, {
    display: (c) => c.display,
    internal: (c) => c.name,
  });
  const groups = useMemo(() => groupExplorerCards(filtered), [filtered]);
  // the flow meters are relative to the busiest recipe of the WHOLE list, so
  // filtering doesn't rescale the bars under the cursor
  const maxFlow = useMemo(() => cards.reduce((m, c) => Math.max(m, c.flow ?? 0), 0), [cards]);

  // cap the rendered rows across groups (Py goods can have 200+ consumers)
  let budget = showAll ? Infinity : LIMIT;
  const visible = groups
    .map((g) => {
      const take = Math.min(g.cards.length, Math.max(0, budget));
      budget -= take;
      return { ...g, cards: g.cards.slice(0, take) };
    })
    .filter((g) => g.cards.length > 0);

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="normal-case">{title}</CardTitle>
      </CardHeader>
      {cards.length === 0 && <div className="px-3 pb-3 text-muted-foreground">{emptyText}</div>}
      {cards.length > 0 && filtered.length === 0 && (
        <FilterEmptyState className="px-3 pb-3" query={query} onClear={onClearQuery} />
      )}
      {visible.map((g) => (
        <div key={g.id}>
          <div
            className="flex items-baseline gap-2 border-t border-border bg-muted/40 px-3 py-1 text-sm font-medium text-muted-foreground"
            title={g.hint}
          >
            {g.label}
            <span className="font-normal">
              {groups.find((x) => x.id === g.id)?.cards.length ?? g.cards.length}
            </span>
          </div>
          {g.cards.map((c) => (
            <RecipeRow key={c.name} card={c} focus={focus} maxFlow={maxFlow} onPick={onPick} />
          ))}
        </div>
      ))}
      {filtered.length > LIMIT && !showAll && (
        <Button
          variant="ghost"
          onClick={() => setShowAll(true)}
          className="w-full justify-start border-t-border px-3 font-normal text-info hover:text-info"
        >
          show all {filtered.length}…
        </Button>
      )}
    </Card>
  );
}
