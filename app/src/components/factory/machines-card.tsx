/**
 * Required-vs-built per machine on the shared sortable-table engine (#80),
 * broken down by the recipe each machine runs. The blocks say how many machines
 * they need per recipe; the game says how many are placed and (for assemblers /
 * active furnaces) what they're set to craft — so a machine built but on the
 * wrong recipe still reads as short. Mining drills / labs / idle furnaces
 * report no recipe; those fall back to a machine-level total. Built counts are
 * force-wide, so this is the factory-level picture.
 *
 * Same anatomy as the goods sections (`goods-table.tsx`): headless TanStack
 * Table for sorting (persisted per browser), collapsible, height-capped with a
 * sticky sortable header. Sorting moves whole machine groups — the nested
 * per-recipe rows travel with their machine (worst-short recipe first, as the
 * server orders them).
 */
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { StatCell } from "#/components/stat-cell.tsx";
import { StatSortHeader } from "#/components/stat-sort-header.tsx";
import { Icon } from "../../lib/icons";
import { timeAgo } from "../../lib/format";
import { fmtMachineCount, isWholeCount, wholeMachines } from "../../lib/machine-count";
import { usePersistedFold, usePersistedSorting } from "../../lib/use-table-prefs";

export type MachineRow = {
  machine: string;
  display: string;
  requiredTotal: number;
  builtTotal: number;
  recipeAware: boolean;
  unassignedBuilt: number;
  short: number;
  recipes: {
    recipe: string;
    display: string;
    required: number;
    built: number | null;
    short: number;
  }[];
};

export type MachineSufficiency = {
  machines: MachineRow[];
  syncedAt: string | null;
  syncedCount: number | null;
};

const col = createColumnHelper<MachineRow>();
// Columns exist for their accessors/sorting semantics; rendering stays manual.
const columns = [
  col.accessor((r) => r.display.toLowerCase(), { id: "machine", header: "machine · recipe" }),
  col.accessor("builtTotal", { id: "built", header: "built" }),
  col.accessor("requiredTotal", { id: "required", header: "required" }),
  col.accessor("short", { id: "short", header: "short" }),
];

// header/cell width per column id — must match the StatCell `w` in the rows
const HEAD_W: Record<string, string> = {
  machine: "flex-1 text-left",
  built: "w-20 justify-end",
  required: "w-20 justify-end",
  short: "w-24 justify-end",
};

/** A required count: whole (built) counts show the integer as-is;
 * fractional solves show the exact ratio with the build target in the title. */
function RequiredCount({ n }: { n: number }) {
  if (isWholeCount(n)) return <>{fmtMachineCount(n)}</>;
  // tooltip keeps two decimals even where the cell rounds (formatQty drops
  // decimals at ≥100), so "124" still reads as the 123.51 it stands for
  return (
    <Tooltip content={`${Number(n.toFixed(2))} exact — build ${wholeMachines(n)} whole machines`}>
      <span>{fmtMachineCount(n)}</span>
    </Tooltip>
  );
}

export function MachinesCard({ data }: { data: MachineSufficiency }) {
  const [sorting, onSortingChange] = usePersistedSorting("pyops.factorySort.machines", [
    { id: "short", desc: true },
    { id: "required", desc: true },
  ]);
  const [folded, toggleFold] = usePersistedFold("pyops.factoryFold.machines");
  const rows = data.machines;
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (rows.length === 0 && !data.syncedAt) return null;
  const shortCount = rows.filter((m) => m.short > 0).length;

  return (
    <Card className="mt-4 max-w-3xl">
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
            Machines ({rows.length})
            {shortCount > 0 && (
              <span className="ml-2 text-sm font-normal text-destructive">
                {shortCount} under-built
              </span>
            )}
          </CardTitle>
        </button>
        <span className="text-sm text-muted-foreground">
          {data.syncedAt ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Check className="size-3.5" /> live: {data.syncedCount ?? 0} placed (
              {timeAgo(data.syncedAt)})
            </span>
          ) : (
            "no built-machine data — open the PyOps panel in-game and Sync"
          )}
        </span>
      </CardHeader>
      {!folded &&
        (rows.length === 0 ? (
          <EmptyState
            className="px-3 py-4"
            title="No machines yet"
            description="no enabled block requires machines and none are placed in-game"
          />
        ) : (
          // capped so a big factory scrolls internally instead of pushing the
          // page — the sorted top IS the work list (same as the goods sections)
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            <StatSortHeader headers={table.getFlatHeaders()} widths={HEAD_W} />
            {table.getRowModel().rows.map(({ original: m }) => (
              <div key={m.machine} className="border-t border-border" data-testid="machine-group">
                {/* machine summary */}
                <div className="flex flex-col gap-1 px-3 py-2 text-sm md:flex-row md:items-center md:gap-2 md:py-1.5">
                  <span className="flex min-w-0 items-center gap-2 md:flex-1">
                    <Icon kind="item" name={m.machine} size="sm" title={m.display} />
                    <span
                      className="min-w-0 flex-1 truncate font-semibold"
                      title={m.display}
                      data-testid="machine-name"
                    >
                      {m.display}
                      {!m.recipeAware && m.builtTotal > 0 && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          (no recipe data)
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="grid grid-cols-3 gap-x-3 pl-7 md:flex md:gap-2 md:pl-0">
                    <StatCell label="built" w="md:w-20" className="text-muted-foreground">
                      {m.builtTotal}
                    </StatCell>
                    <StatCell label="required" w="md:w-20" className="text-warning">
                      <RequiredCount n={m.requiredTotal} />
                    </StatCell>
                    <StatCell
                      label="short"
                      w="md:w-24"
                      className={`font-semibold ${m.short > 0 ? "text-destructive" : "text-success"}`}
                    >
                      {m.short > 0 ? `need ${m.short}` : <Check className="inline size-4" />}
                    </StatCell>
                  </span>
                </div>
                {/* per-recipe breakdown (only meaningful when recipe-aware) */}
                {m.recipeAware &&
                  m.recipes.map((r) => (
                    <div
                      key={r.recipe}
                      className="flex flex-col gap-0.5 py-1 pr-3 pl-10 text-sm text-muted-foreground md:flex-row md:items-center md:gap-2 md:py-0.5"
                    >
                      <span className="flex min-w-0 items-center gap-2 md:flex-1">
                        <Icon kind="recipe" name={r.recipe} size="sm" title={r.display} />
                        <span className="min-w-0 flex-1 truncate" title={r.display}>
                          {r.display}
                        </span>
                      </span>
                      <span className="grid grid-cols-3 gap-x-3 pl-6 md:flex md:gap-2 md:pl-0">
                        <StatCell label="built" w="md:w-20">
                          {r.built ?? "—"}
                        </StatCell>
                        <StatCell label="required" w="md:w-20">
                          <RequiredCount n={r.required} />
                        </StatCell>
                        <StatCell
                          label="short"
                          w="md:w-24"
                          className={r.short > 0 ? "text-destructive" : "text-success/70"}
                        >
                          {r.short > 0 ? `need ${r.short}` : <Check className="inline size-3.5" />}
                        </StatCell>
                      </span>
                    </div>
                  ))}
                {m.recipeAware && m.unassignedBuilt > 0 && (
                  <div className="flex items-center gap-2 py-0.5 pr-3 pl-10 text-sm text-muted-foreground/70 italic">
                    <span className="min-w-0 flex-1">
                      {m.unassignedBuilt} built with no recipe set (idle / spare)
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </Card>
  );
}
