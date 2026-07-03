/**
 * Factory goods sections on TanStack Table (#77): headless — the table engine
 * owns sorting state + row models only; the markup (badges, drawer-clicks, the
 * mobile card-stacking) is entirely ours. Each section is independently
 * sortable (click a header) and collapsible, both remembered per section in
 * localStorage. Deficits sort by "% of demand met" by default, so a fully
 * starved 0.3/s intermediate outranks a half-fed 500/s bulk fluid.
 */
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { StatCell } from "#/components/stat-cell.tsx";
import { StatSortHeader } from "#/components/stat-sort-header.tsx";
import { Icon } from "../lib/icons";
import { rateLabel } from "../lib/format";
import { usePersistedFold, usePersistedSorting } from "../lib/use-table-prefs";

export type GoodsRow = {
  item: string;
  kind: string;
  display: string | null;
  produced: number;
  consumed: number;
  net: number;
  /** produced ÷ consumed — the severity axis; null when nothing consumes it */
  pctMet: number | null;
  /** some production comes from a keep-in-stock goal (#38) */
  stock: boolean;
  actualProduced: number | null;
};

const col = createColumnHelper<GoodsRow>();
// Columns exist for their accessors/sorting semantics; rendering stays manual.
// Nullable axes map null → undefined so sortUndefined can pin them last.
const columns = [
  col.accessor((r) => (r.display ?? r.item).toLowerCase(), { id: "item", header: "item" }),
  col.accessor("produced", { id: "produced", header: "produced/s" }),
  col.accessor("consumed", { id: "consumed", header: "consumed/s" }),
  col.accessor("net", { id: "net", header: "net/s" }),
  col.accessor((r) => r.pctMet ?? undefined, { id: "met", header: "met", sortUndefined: "last" }),
  col.accessor((r) => r.actualProduced ?? undefined, {
    id: "actual",
    header: "actual/s",
    sortUndefined: "last",
  }),
];

// header/cell width per column id — the same flex layout the sections always had
const HEAD_W: Record<string, string> = {
  item: "flex-1 text-left",
  produced: "w-24 justify-end",
  consumed: "w-24 justify-end",
  net: "w-24 justify-end",
  met: "w-14 justify-end",
  actual: "w-24 justify-end",
};

function ActualCell({
  good,
  planned,
  actual,
}: {
  good: string;
  planned: number;
  actual: number | null;
}) {
  if (actual == null) return <span className="text-muted-foreground/50">—</span>;
  let color = "text-muted-foreground";
  if (planned > 1e-6) {
    const ratio = actual / planned;
    color = ratio < 0.5 ? "text-destructive" : ratio < 0.9 ? "text-warning" : "text-success";
  }
  return (
    <span
      className={color}
      title={`making ${rateLabel(good, actual, { perSec: true })} · planned ${rateLabel(good, planned, { perSec: true })}`}
    >
      {rateLabel(good, actual)}
    </span>
  );
}

/** % of demand met — the deficit list's severity color: 0% (nothing makes it)
 * is alarming no matter how small the absolute rate is. */
function MetCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground/50">—</span>;
  const shown = Math.round(pct * 100);
  const color = pct < 0.25 ? "text-destructive" : pct < 0.75 ? "text-warning" : "text-success";
  return (
    <span className={`font-semibold ${color}`} title="produced ÷ consumed across all blocks">
      {shown}%
    </span>
  );
}

export function GoodsSection({
  id,
  title,
  hint,
  rows,
  defaultSorting,
  showMet = false,
  selectedItem,
  onSelect,
}: {
  /** stable key for persisted sort/fold state */
  id: string;
  title: string;
  hint: string;
  rows: GoodsRow[];
  defaultSorting: SortingState;
  /** show the %-met column (the deficit list's severity axis) */
  showMet?: boolean;
  selectedItem: string | null;
  onSelect: (r: GoodsRow) => void;
}) {
  const [sorting, onSortingChange] = usePersistedSorting(`pyops.factorySort.${id}`, defaultSorting);
  const [folded, toggleFold] = usePersistedFold(`pyops.factoryFold.${id}`);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility: { met: showMet } },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="justify-between">
        <button
          onClick={toggleFold}
          className="flex items-center gap-1 text-left"
          title={folded ? "expand" : "collapse"}
        >
          {folded ? (
            <ChevronRight className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
          <CardTitle className="normal-case">
            {title} ({rows.length})
          </CardTitle>
        </button>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </CardHeader>
      {!folded && (
        // capped so a late-game 200-row section scrolls internally instead of
        // pushing its siblings off-page — the sorted top IS the work list.
        // (Also the fixed-height container react-virtual would want, if ever.)
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
          <StatSortHeader headers={table.getFlatHeaders()} widths={HEAD_W} />
          {table.getRowModel().rows.map(({ original: r }) => (
            <button
              key={r.item}
              onClick={() => onSelect(r)}
              className={`flex w-full flex-col gap-1 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted md:flex-row md:items-center md:gap-2 md:py-1.5 ${selectedItem === r.item ? "bg-accent" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2 md:flex-1">
                <Icon
                  kind={r.kind as "item" | "fluid"}
                  name={r.item}
                  size="sm"
                  title={r.display ?? r.item}
                />
                <span className="min-w-0 flex-1 truncate" title={r.display ?? r.item}>
                  {r.display ?? r.item}
                </span>
                {r.stock && (
                  <Badge
                    title="some of this production is a stock-refill demand (a 'keep N on hand' goal), not continuous throughput"
                    className="shrink-0 border-transparent bg-info/15 px-1 py-0 text-info"
                  >
                    <RefreshCw className="size-3" /> stock
                  </Badge>
                )}
              </span>
              <span className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-7 md:flex md:gap-2 md:pl-0">
                <StatCell label="produced/s" layout="row" w="md:w-24" className="text-success">
                  {rateLabel(r.item, r.produced)}
                </StatCell>
                <StatCell label="consumed/s" layout="row" w="md:w-24" className="text-warning">
                  {rateLabel(r.item, r.consumed)}
                </StatCell>
                <StatCell
                  label="net/s"
                  layout="row"
                  w="md:w-24"
                  className={`font-semibold ${
                    r.net < -1e-6
                      ? "text-destructive"
                      : r.net > 1e-6
                        ? "text-surplus"
                        : "text-muted-foreground"
                  }`}
                >
                  {rateLabel(r.item, r.net, { sign: true })}
                </StatCell>
                {showMet && (
                  <StatCell label="met" layout="row" w="md:w-14">
                    <MetCell pct={r.pctMet} />
                  </StatCell>
                )}
                <StatCell label="actual/s" layout="row" w="md:w-24">
                  <ActualCell good={r.item} planned={r.produced} actual={r.actualProduced} />
                </StatCell>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
