/**
 * Snapshot history drawer (#85): a block's restore points — manual "snapshot
 * now" (optional label) plus the automatic ones taken before destructive or
 * structural writes. Each row can show a diff against the current editor state
 * and restore (which auto-snapshots first and is itself one undoable action).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, History } from "lucide-react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "#/components/ui/sheet.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import type { BlockData } from "../../db/schema.ts";
import {
  createSnapshotFn,
  deleteSnapshotFn,
  listSnapshotsFn,
  restoreSnapshotFn,
  snapshotDiffFn,
} from "../../server/snapshot-fns";
import type { SolveInput } from "../../server/block-compute.server.ts";

import { SnapshotDiffView } from "./snapshot-diff.tsx";

export function SnapshotSheet({
  blockId,
  onClose,
  currentName,
  currentDoc,
  persistNow,
  onRestored,
}: {
  blockId: number;
  onClose: () => void;
  /** the editor's live name/doc — diffs run against what's on screen */
  currentName: string;
  currentDoc: SolveInput;
  /** flush any pending editor auto-save, so a manual snapshot matches the screen */
  persistNow: () => Promise<unknown>;
  /** push the restored definition back into the open editor (doc.hydrate) */
  onRestored: (r: { name: string; enabled: boolean; doc: BlockData }) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ["snapshots", blockId],
    queryFn: () => listSnapshotsFn({ data: blockId }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["snapshots", blockId] });

  const snapshotNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await persistNow(); // the row must match what's on screen
      await createSnapshotFn({ data: { blockId, label: label.trim() || undefined } });
      setLabel("");
      await refresh();
    } catch {
      setError("couldn't take the snapshot — is the server reachable?");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (snapshotId: number) => {
    setBusy(true);
    setError(null);
    try {
      await persistNow(); // so the auto "before restore" point captures the screen state
      const res = await restoreSnapshotFn({ data: { blockId, snapshotId } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onRestored(res);
      setExpandedId(null);
      void qc.invalidateQueries({ queryKey: ["blocks"] });
      void qc.invalidateQueries({ queryKey: ["factory"] });
      await refresh();
    } catch {
      setError("restore failed — is the server reachable?");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (snapshotId: number) => {
    if (confirmDeleteId !== snapshotId) {
      setConfirmDeleteId(snapshotId);
      return;
    }
    setConfirmDeleteId(null);
    await deleteSnapshotFn({ data: snapshotId });
    await refresh();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" aria-describedby={undefined} className="w-[30rem] max-w-[92vw]">
        <SheetHeader className="h-auto gap-2 py-3 pr-12">
          <History className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">Snapshots</SheetTitle>
            <div className="truncate text-sm text-muted-foreground">
              {currentName || "this block"} — named restore points beyond undo&apos;s reach
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-3 flex items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void snapshotNow()}
              placeholder="label (optional) — e.g. before TURD swap"
              className="min-w-0 flex-1"
            />
            <Button onClick={() => void snapshotNow()} disabled={busy} className="shrink-0 gap-1.5">
              <Camera className="size-4" />
              Snapshot now
            </Button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Automatic snapshots are taken before deletes, restores, resizes, and (at most every 10
            minutes) ordinary edits; the newest 20 are kept per block. Manual snapshots stay until
            you delete them.
          </p>

          {error && (
            <Callout tone="destructive" className="mb-3">
              {error}
            </Callout>
          )}

          {list.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          )}
          {list.isError && (
            <Callout tone="destructive">couldn&apos;t load this block&apos;s snapshots.</Callout>
          )}
          {list.data && list.data.length === 0 && (
            <EmptyState
              icon={History}
              title="No snapshots yet"
              description="Take one before a big refactor — automatic ones will also appear here before deletes, restores, and other structural changes."
            />
          )}

          <div className="space-y-2">
            {list.data?.map((s) => (
              <div key={s.id} className="border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={s.name}>
                    {s.label || s.name}
                  </span>
                  <Badge
                    className={
                      s.kind === "manual"
                        ? "border-transparent bg-info/15 text-info"
                        : "border-transparent bg-muted text-muted-foreground"
                    }
                  >
                    {s.kind === "manual" ? "manual" : `auto${s.label ? ` · ${s.label}` : ""}`}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {s.createdAt ? new Date(s.createdAt * 1000).toLocaleString() : ""}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {s.name} · {s.goalCount} {s.goalCount === 1 ? "goal" : "goals"} ·{" "}
                    {s.recipeCount} {s.recipeCount === 1 ? "recipe" : "recipes"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  >
                    {expandedId === s.id ? "Hide diff" : "Diff"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void restore(s.id)}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={
                      confirmDeleteId === s.id
                        ? "border-destructive/60 text-destructive"
                        : "text-muted-foreground"
                    }
                    onBlur={() => setConfirmDeleteId(null)}
                    onClick={() => void remove(s.id)}
                  >
                    {confirmDeleteId === s.id ? "delete?" : "Delete"}
                  </Button>
                </div>
                {expandedId === s.id && (
                  <SnapshotRowDiff
                    snapshotId={s.id}
                    snapshotName={s.name}
                    currentName={currentName}
                    currentDoc={currentDoc}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The expanded diff of one snapshot row: fetches snapshot-vs-current on open. */
function SnapshotRowDiff({
  snapshotId,
  snapshotName,
  currentName,
  currentDoc,
}: {
  snapshotId: number;
  snapshotName: string;
  currentName: string;
  currentDoc: SolveInput;
}) {
  const diff = useQuery({
    // keyed on the doc so an edit while the drawer is open refreshes the diff
    queryKey: ["snapshotDiff", snapshotId, JSON.stringify(currentDoc)],
    queryFn: () => snapshotDiffFn({ data: { snapshotId, current: currentDoc } }),
  });
  return (
    <div className="mt-2 border-t border-border pt-1">
      {diff.isLoading && <Skeleton className="h-10 w-full" />}
      {diff.isError && <Callout tone="destructive">couldn&apos;t compute the diff.</Callout>}
      {diff.data === null && (
        <p className="py-1 text-sm text-muted-foreground italic">this snapshot no longer exists.</p>
      )}
      {diff.data && (
        <SnapshotDiffView
          diff={diff.data.diff}
          refs={diff.data.refs}
          nameChange={snapshotName !== currentName ? { from: snapshotName, to: currentName } : null}
        />
      )}
    </div>
  );
}
