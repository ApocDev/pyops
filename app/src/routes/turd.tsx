import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import {
  listBlocksFn,
  setTurdSelectionFn,
  turdBoardFn,
  turdSyncStatusFn,
} from "../server/factorio";
import { IconProvider } from "../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { SyncStatus } from "#/components/sync-status.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { TurdGroupRow, groupBlockCount } from "#/components/turd/turd-group-row.tsx";
import { useFilteredList } from "../lib/use-filtered-list";
import { countNoun } from "../lib/delete-copy";
import { usePageEntity } from "../lib/page-context";
import { useState } from "react";

export const Route = createFileRoute("/turd")({
  component: () => (
    <IconProvider>
      <TurdPage />
    </IconProvider>
  ),
});

/** A TURD pick waiting on the confirm dialog. `sub` null = clear the master's choice. */
type PendingChoice = {
  master: { name: string; display: string };
  sub: { name: string; display: string } | null;
  /** Display name of the master's current choice, if any. */
  current: string | null;
};

type Show = "all" | "chosen" | "unchosen" | "mine";

/** Pyanodon TURD board: an accordion of TURD groups (chosen first, then groups
 * that touch the player's blocks), each expanding into its options side by side.
 * Choose or Clear opens a confirm naming the blocks that re-solve; the write is
 * one undo step. */
function TurdPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const upgrades = useQuery({ queryKey: ["turd"], queryFn: () => turdBoardFn() });
  const sync = useQuery({
    queryKey: ["turd-sync"],
    queryFn: () => turdSyncStatusFn(),
    refetchInterval: 4000,
  });
  // every block that isn't broken re-solves after a pick (resolveAllBlocks)
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const resolving = (blocks.data ?? []).filter((b) => !b.broken);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const select = useMutation({
    mutationFn: (d: { masterTech: string; subTech: string | null }) =>
      setTurdSelectionFn({ data: d }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["turd"] });
      void qc.invalidateQueries({ queryKey: ["solve"] });
      void qc.invalidateQueries({ queryKey: ["blocks"] });
      void qc.invalidateQueries({ queryKey: ["undoStatus"] }); // the pick is the new top undo step
    },
  });

  // a master matches when it or any of its branches does; internal tech names
  // are the hidden fallback (useful when pasting a raw name from a doc/issue)
  const list = useFilteredList(upgrades.data ?? [], search, {
    display: (u) => [u.display, ...u.subTechs.map((s) => s.display)],
    internal: (u) => [u.name, ...u.subTechs.map((s) => s.name)],
  });
  const all = upgrades.data ?? [];
  const chosen = all.filter((u) => u.selected).length;
  const mine = all.filter((u) => groupBlockCount(u) > 0).length;
  const tier = (u: (typeof all)[number]) => (u.selected ? 2 : groupBlockCount(u) > 0 ? 1 : 0);
  const shown = list
    .filter((u) =>
      show === "chosen"
        ? u.selected
        : show === "unchosen"
          ? !u.selected
          : show === "mine"
            ? groupBlockCount(u) > 0
            : true,
    )
    // a search keeps its relevance order inside each tier
    .sort((a, b) => tier(b) - tier(a) || (search ? 0 : a.display.localeCompare(b.display)));
  // the most recently expanded group is the dock's page context
  const focusedName = [...open].at(-1);
  const focused = all.find((u) => u.name === focusedName);
  usePageEntity(
    focused
      ? {
          kind: "turd",
          id: focused.name,
          label: focused.display,
          icon: { kind: "technology", name: focused.name },
        }
      : null,
  );
  const toggle = (name: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <div className="p-4 font-mono text-foreground">
      <ConfirmDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending?.sub ? "Choose TURD upgrade" : "Clear TURD choice"}
        description={
          pending && (
            <>
              <span className="block">
                {pending.sub ? (
                  <>
                    Choose <span className="text-foreground">{pending.sub.display}</span> for{" "}
                    <span className="text-foreground">{pending.master.display}</span>?
                    {pending.current && ` This replaces ${pending.current}.`}
                  </>
                ) : (
                  <>
                    Clear <span className="text-foreground">{pending.current}</span> from{" "}
                    <span className="text-foreground">{pending.master.display}</span>?
                  </>
                )}
              </span>
              <span className="mt-2 block">
                {blocks.isPending
                  ? "Loading blocks…"
                  : blocks.isError
                    ? "Couldn't load the block list. Every block that isn't broken will re-solve."
                    : resolving.length === 0
                      ? "No blocks to re-solve."
                      : `This re-solves ${countNoun(resolving.length, "block")}:`}
              </span>
              {resolving.length > 0 && (
                <span className="mt-1 block max-h-48 overflow-y-auto border border-border/50 px-2 py-1">
                  {resolving.map((b) => (
                    <span key={b.id} className="block truncate text-foreground">
                      {b.name}
                    </span>
                  ))}
                </span>
              )}
              <span className="mt-2 block">You can undo this afterwards.</span>
            </>
          )
        }
        confirmLabel={pending?.sub ? "Choose upgrade" : "Clear choice"}
        onConfirm={() => {
          if (pending)
            select.mutate({ masterTech: pending.master.name, subTech: pending.sub?.name ?? null });
        }}
      />
      <PageHeader
        title="TURD upgrades"
        description={`${chosen} of ${all.length} chosen`}
        actions={
          <HelpButton title="What are TURD upgrades?">
            <p>
              <span className="text-foreground">TURD</span> is Pyanodons&apos; recipe-upgrade
              system: certain technologies offer a{" "}
              <span className="text-foreground">one-time choice</span> between mutually-exclusive
              recipe branches. Picking one swaps in its (usually better or quite different) recipes
              — and it&apos;s effectively permanent, so it&apos;s a real planning decision.
            </p>
            <p>
              This page lists every TURD master and its options. Your actual in-game picks{" "}
              <span className="text-foreground">sync from the mod</span> (the sync status beside the
              filter); choosing one here re-solves every block that uses an affected recipe.
            </p>
            <div>
              <div className="font-semibold text-foreground">How PyOps treats it</div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  Planning <span className="text-foreground">&quot;Now&quot;</span> uses only
                  recipes you can build today — a branch you haven&apos;t picked is excluded until
                  you pick it.
                </li>
                <li>
                  Unpicked branches surface as{" "}
                  <span className="text-foreground">available upgrades</span> to consider, never
                  auto-applied — PyOps reflects your choices, it doesn&apos;t make them for you.
                </li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-foreground">Worked example</div>
              <p className="mt-1">
                The Dhilmo TURD&apos;s <span className="text-foreground">double intake</span> branch
                swaps that recipe&apos;s saline-water input for plain{" "}
                <span className="text-foreground">water + salt</span> — the Dhilmo output is
                unchanged, but the upstream demand shifts. Pick it here and every block that makes
                Dhilmo re-solves to draw water and salt instead of saline water; in Factory Overview
                and Connections you&apos;ll then see the saline-water demand drop and new water/salt
                demand appear. Because the swap is one-time and near-permanent, decide it before you
                build out the upstream supply.
              </p>
            </div>
          </HelpButton>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <FilterInput
            value={search}
            onValueChange={setSearch}
            placeholder="Filter upgrades…"
            className="w-64"
          />
          <Segmented
            aria-label="Show"
            value={show}
            onValueChange={setShow}
            options={[
              { value: "all", label: <>All {all.length}</> },
              { value: "chosen", label: <>Chosen {chosen}</> },
              { value: "unchosen", label: <>Not chosen {all.length - chosen}</> },
              {
                value: "mine",
                label: (
                  <>
                    <Boxes />
                    <span className="max-sm:sr-only">My blocks</span> {mine}
                  </>
                ),
              },
            ]}
          />
          {select.isPending && <span className="text-sm text-warning">Re-solving blocks…</span>}
          {select.data && !select.isPending && (
            <span className="text-sm text-muted-foreground">
              Re-solved {countNoun(select.data.resolved, "block")}
            </span>
          )}
          {sync.data?.syncedAt && (
            <SyncStatus syncedAt={sync.data.syncedAt}>
              {" "}
              · {sync.data.syncedCount ?? 0} synced
              {sync.data.unknown.length > 0 && (
                <Tooltip
                  content={sync.data.unknown.map((u) => `${u.master} → ${u.sub}`).join("\n")}
                >
                  <span className="ml-1 text-warning">· {sync.data.unknown.length} unmatched</span>
                </Tooltip>
              )}
            </SyncStatus>
          )}
        </div>
      </PageHeader>

      {upgrades.isLoading && (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}

      {upgrades.isError && (
        <QueryError message={upgrades.error.message} onRetry={() => void upgrades.refetch()} />
      )}

      {upgrades.isSuccess && all.length === 0 && (
        <EmptyState
          title="No TURD upgrades in this dataset"
          description="TURD is a Pyanodons mechanic — sync a mod set that includes it (e.g. pyalienlife) and its upgrades appear here. (This tab is hidden from the nav when there's no TURD data.)"
        />
      )}

      {all.length > 0 &&
        shown.length === 0 &&
        (search.trim() ? (
          <FilterEmptyState
            query={search}
            onClear={() => {
              setSearch("");
              setShow("all");
            }}
          />
        ) : (
          <EmptyState
            title="No upgrades in this view"
            action={
              <Button variant="outline" size="sm" onClick={() => setShow("all")}>
                Show all
              </Button>
            }
          />
        ))}

      {shown.length > 0 && (
        <div className="flex flex-col divide-y divide-border border border-border">
          {shown.map((u) => (
            <TurdGroupRow
              key={u.name}
              group={u}
              open={open.has(u.name)}
              onToggle={() => toggle(u.name)}
              disabled={select.isPending}
              onChoose={(s) =>
                setPending({
                  master: u,
                  sub: s,
                  current: u.subTechs.find((x) => x.name === u.selected)?.display ?? null,
                })
              }
              onClear={(s) => setPending({ master: u, sub: null, current: s.display })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
