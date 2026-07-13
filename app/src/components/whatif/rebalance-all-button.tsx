import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { rateLabel } from "#/lib/format.ts";
import { toast } from "#/lib/toast-store.ts";
import { undoToast } from "#/lib/undo-client.ts";
import { applyPinnedFactoryFn } from "#/server/factorio.ts";

/** One block on the what-if work list — the fields the confirm summary needs. */
type BlockChange = {
  id: number;
  name: string;
  good: string | null;
  currentRate: number;
  requiredRate: number;
  scale: number;
  delta: number;
  /** true when this changes a specific goal instead of an opaque block rate */
  goal?: boolean;
  /** Starts a valid producer whose current goal is zero. */
  activation?: boolean;
};

// Query families the apply touches — everything a block rate change feeds. Mirrors
// undo-client's UNDO_QUERY_KEYS (this is a bulk block write) plus the what-if solve.
const REFRESH_KEYS = [
  ["whatif"],
  ["blocks"],
  ["block"],
  ["blocksForGood"],
  ["factory"],
  ["factoryTotals"],
  ["coherence"],
  ["undoStatus"],
] as const;

const MOVERS_SHOWN = 6;

/**
 * Commit the pinned factory plan — set every listed goal to its required rate
 * in one undo step. Opens a
 * (non-destructive) confirm summarizing the biggest movers first, since it's a
 * factory-wide write; the result is fully reversible via the undo toast.
 *
 * `status` is the LP status: a non-Optimal result has no safe plan to apply.
 */
export function RebalanceAllButton({
  changed,
  overrides,
  status,
  onApplied,
}: {
  changed: BlockChange[];
  overrides: Record<string, number>;
  status: string | undefined;
  onApplied: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const notOptimal = status != null && status !== "Optimal";
  const applyingScenario = Object.keys(overrides).length > 0;
  const disabledReason =
    changed.length === 0
      ? "Nothing to re-balance — every block already meets demand"
      : notOptimal
        ? `The solve is ${status} — the target can't be met, so there's nothing safe to apply`
        : null;

  // biggest movers first, so the confirm shows what matters at a glance
  const movers = [...changed].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const apply = async () => {
    setApplying(true);
    try {
      const res = await applyPinnedFactoryFn({ data: { demands: overrides } });
      // a non-Optimal solve is left unapplied server-side — say so and stop
      if (res.status !== "Optimal") {
        toast({
          message: `Couldn't re-balance — the solve is ${res.status}. Nothing changed.`,
          tone: "destructive",
        });
        return;
      }
      await Promise.all(
        REFRESH_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
      );
      onApplied();
      if (res.applied.length) {
        const n = res.applied.length;
        undoToast(qc, `Balanced ${n} block${n === 1 ? "" : "s"} from the factory pins`);
      }
      if (res.broken.length)
        toast({
          message: `${res.broken.length} block${res.broken.length === 1 ? "" : "s"} couldn't re-solve at the new rate — left unchanged`,
          tone: "destructive",
        });
      if (!res.applied.length && !res.broken.length)
        toast({ message: "Already balanced — nothing to apply", tone: "success" });
    } finally {
      setApplying(false);
      setOpen(false);
    }
  };

  const button = (
    <Button size="sm" disabled={disabledReason != null || applying} onClick={() => setOpen(true)}>
      {applying ? "applying…" : applyingScenario ? "Apply scenario" : "Balance factory"}
    </Button>
  );

  return (
    <>
      {disabledReason ? (
        // a disabled button fires no pointer events — wrap so the tooltip still shows
        <Tooltip content={disabledReason}>
          <span className="inline-flex">{button}</span>
        </Tooltip>
      ) : (
        <Tooltip content="Set every listed goal to its required rate in one step — undoable">
          {button}
        </Tooltip>
      )}

      <Dialog open={open} onOpenChange={(o) => !applying && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {applyingScenario ? "Apply this factory scenario?" : "Balance the whole factory?"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-3 p-3">
            <DialogDescription>
              Applies {changed.length} block or goal change{changed.length === 1 ? "" : "s"} the
              solve found and re-solves each affected block. This is a single undo step.
            </DialogDescription>

            <div className="max-h-64 min-h-0 overflow-auto border border-border">
              {movers.slice(0, MOVERS_SHOWN).map((b) => (
                <div
                  key={`${b.id}-${b.goal ? b.good : "primary"}`}
                  className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                    <span className="text-muted-foreground">
                      {rateLabel(b.good ?? "", b.currentRate)}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-foreground/60" />
                    <span className={b.delta > 0 ? "text-warning" : "text-info"}>
                      {rateLabel(b.good ?? "", b.requiredRate)}
                    </span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
                    {b.activation ? "start" : `×${b.scale}`}
                  </span>
                </div>
              ))}
              {movers.length > MOVERS_SHOWN && (
                <div className="px-3 py-1.5 text-sm text-muted-foreground">
                  …and {movers.length - MOVERS_SHOWN} more
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={applying}>
              {applying
                ? "applying…"
                : `Apply ${changed.length} change${changed.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
