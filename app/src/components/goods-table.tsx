/**
 * Factory goods sections on TanStack Table (#77): headless — the table engine
 * owns sorting state + row models only; the markup (badges, drawer-clicks, the
 * mobile card-stacking) is entirely ours. Each section is independently
 * sortable (click a header) and collapsible, both remembered per section in
 * localStorage. Deficits sort by "% of demand met" by default, so a fully
 * starved 0.3/s intermediate outranks a half-fed 500/s bulk fluid.
 */
import { useState } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { StatCell } from "#/components/stat-cell.tsx";
import { Icon } from "../lib/icons";
import { formatQty as num } from "../lib/format";

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
  produced: "w-24 text-right",
  consumed: "w-24 text-right",
  net: "w-24 text-right",
  met: "w-14 text-right",
  actual: "w-24 text-right",
};

function ActualCell({ planned, actual }: { planned: number; actual: number | null }) {
  if (actual == null) return <span className="text-muted-foreground/50">—</span>;
  let color = "text-muted-foreground";
  if (planned > 1e-6) {
    const ratio = actual / planned;
    color = ratio < 0.5 ? "text-destructive" : ratio < 0.9 ? "text-amber-300" : "text-emerald-300";
  }
  return (
    <span className={color} title={`making ${num(actual)}/s · planned ${num(planned)}/s`}>
      {num(actual)}
    </span>
  );
}

/** % of demand met — the deficit list's severity color: 0% (nothing makes it)
 * is alarming no matter how small the absolute rate is. */
function MetCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground/50">—</span>;
  const shown = Math.round(pct * 100);
  const color =
    pct < 0.25 ? "text-destructive" : pct < 0.75 ? "text-amber-300" : "text-emerald-300";
  return (
    <span className={`font-semibold ${color}`} title="produced ÷ consumed across all blocks">
      {shown}%
    </span>
  );
}

const readJSON = (key: string) => {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

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
  const sortKey = `pyops.factorySort.${id}`;
  const [sorting, setSorting] = useState<SortingState>(() => {
    const saved = readJSON(sortKey);
    return Array.isArray(saved) && saved.length ? (saved as SortingState) : defaultSorting;
  });
  const onSortingChange = (u: Updater<SortingState>) =>
    setSorting((old) => {
      const next = typeof u === "function" ? u(old) : u;
      if (typeof localStorage !== "undefined") localStorage.setItem(sortKey, JSON.stringify(next));
      return next;
    });
  const foldKey = `pyops.factoryFold.${id}`;
  const [folded, setFolded] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(foldKey) === "1",
  );
  const toggleFold = () =>
    setFolded((f) => {
      localStorage.setItem(foldKey, f ? "0" : "1");
      return !f;
    });

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
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardHeader>
      {!folded && (
        // capped so a late-game 200-row section scrolls internally instead of
        // pushing its siblings off-page — the sorted top IS the work list.
        // (Also the fixed-height container react-virtual would want, if ever.)
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
          <div className="sticky top-0 z-10 hidden bg-card px-3 pb-1 text-xs text-muted-foreground md:flex">
            {table.getFlatHeaders().map((h) => {
              const dir = h.column.getIsSorted();
              return (
                <button
                  key={h.id}
                  onClick={h.column.getToggleSortingHandler()}
                  title="click to sort"
                  className={`flex items-center gap-0.5 hover:text-foreground ${HEAD_W[h.id]} ${h.id === "item" ? "" : "justify-end"} ${dir ? "text-foreground" : ""}`}
                >
                  {h.column.columnDef.header as string}
                  {dir === "asc" && <ArrowUp className="size-3" />}
                  {dir === "desc" && <ArrowDown className="size-3" />}
                </button>
              );
            })}
          </div>
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
                  <span
                    title="some of this production is a stock-refill demand (a 'keep N on hand' goal), not continuous throughput"
                    className="flex shrink-0 items-center gap-0.5 rounded bg-sky-500/15 px-1 text-xs text-sky-300"
                  >
                    <RefreshCw className="size-3" /> stock
                  </span>
                )}
              </span>
              <span className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-7 md:flex md:gap-2 md:pl-0">
                <StatCell label="produced/s" layout="row" w="md:w-24" className="text-emerald-300">
                  {num(r.produced)}
                </StatCell>
                <StatCell label="consumed/s" layout="row" w="md:w-24" className="text-amber-300">
                  {num(r.consumed)}
                </StatCell>
                <StatCell
                  label="net/s"
                  layout="row"
                  w="md:w-24"
                  className={`font-semibold ${
                    r.net < -1e-6
                      ? "text-destructive"
                      : r.net > 1e-6
                        ? "text-violet-300"
                        : "text-muted-foreground"
                  }`}
                >
                  {r.net > 0 ? "+" : ""}
                  {num(r.net)}
                </StatCell>
                {showMet && (
                  <StatCell label="met" layout="row" w="md:w-14">
                    <MetCell pct={r.pctMet} />
                  </StatCell>
                )}
                <StatCell label="actual/s" layout="row" w="md:w-24">
                  <ActualCell planned={r.produced} actual={r.actualProduced} />
                </StatCell>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
