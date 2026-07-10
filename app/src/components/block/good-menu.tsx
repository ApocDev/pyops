import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Lock, MapPin, Plus, Star, Timer, Unlock, X } from "lucide-react";
import { blocksForGoodFn } from "../../server/factorio";
import { bridgeLocateFn } from "../../server/bridge/fns";
import { ContextMenu, ContextMenuItem } from "#/components/context-menu.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Icon, useSpoilables } from "../../lib/icons";
import type { Link } from "./item-chip.tsx";
import { num } from "./format.ts";

/** Right-click context menu for a good — explicit actions (safer than cycling):
 * make a surplus a goal, size the block by an import (or spin up a supplier),
 * jump to other producers, force a disposition, estimate incidental spoilage (#20), and
 * locate the good in-game. Owns its producers query + the locate mutation. */
export function GoodMenu({
  x,
  y,
  name,
  kind,
  link,
  display,
  blockId,
  locked,
  importRate,
  made,
  producedInBlock,
  spoilRate,
  onAddGoal,
  onLock,
  onUnlock,
  onCreateSupplier,
  onMark,
  onUnmark,
  onEditSpoil,
  onClearSpoil,
  onClose,
}: {
  x: number;
  y: number;
  name: string;
  kind: string;
  link: Link;
  display: string;
  /** this block — its own rows are skipped in "produced in" */
  blockId: number;
  /** whether this import currently sizes the block */
  locked: boolean;
  /** the import's current rate /s, when it is one */
  importRate: number | null;
  /** the item is in the block's made set (net ≥ 0, imports forbidden) */
  made: boolean;
  /** some enabled recipe in the block produces it (mark would bind immediately) */
  producedInBlock: boolean;
  /** estimated incidental rot rate /s, null = none */
  spoilRate: number | null;
  onAddGoal: () => void;
  onLock: (rate: number) => void;
  onUnlock: () => void;
  onCreateSupplier: (rate: number) => void;
  onMark: () => void;
  onUnmark: () => void;
  onEditSpoil: () => void;
  onClearSpoil: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const spoilables = useSpoilables();
  const locate = useMutation({
    mutationFn: (d: { name: string; kind: "item" | "fluid" }) => bridgeLocateFn({ data: d }),
  });
  // Which other blocks already make this good — so an import can jump to its
  // producer, or spin up a new block to supply it.
  const ctxProducers = useQuery({
    queryKey: ["blocksForGood", name],
    queryFn: () => blocksForGoodFn({ data: name }),
    staleTime: 0,
  });
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const producers = (ctxProducers.data?.producers ?? []).filter((p) => p.blockId !== blockId);
  return (
    <ContextMenu x={x} y={y} onClose={onClose} className="min-w-52">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-sm text-muted-foreground">
        <Icon kind={kind as "item" | "fluid"} name={name} size="sm" title={display} />
        <span className="truncate">{display}</span>
      </div>
      {link === "export" && (
        <ContextMenuItem onClick={act(onAddGoal)}>
          <Star className="size-3.5" /> Make a goal
        </ContextMenuItem>
      )}
      {link === "import" && (
        <>
          <ContextMenuItem
            active={locked}
            onClick={act(() => {
              if (locked) onUnlock();
              else onLock(importRate != null ? +importRate.toFixed(4) : 0);
            })}
          >
            {locked ? (
              <>
                <Unlock className="size-3.5" /> Unlock sizing
              </>
            ) : (
              <>
                <Lock className="size-3.5" /> Size block by this input
              </>
            )}
          </ContextMenuItem>
          <ContextMenuItem onClick={act(() => onCreateSupplier(importRate ?? 0))}>
            <Plus className="size-3.5" /> Create block to make this
          </ContextMenuItem>
        </>
      )}
      {/* Jump to other blocks that already produce this good (skip self). */}
      {producers.length > 0 && (
        <>
          <div className="my-1 border-t border-border" />
          <FieldLabel className="px-3 pb-0.5 font-semibold">produced in</FieldLabel>
          {producers.map((p) => (
            <ContextMenuItem
              key={p.blockId}
              className="gap-1.5"
              onClick={act(() => {
                void navigate({ to: "/block/$id", params: { id: String(p.blockId) } });
              })}
            >
              {p.iconKind && p.iconName ? (
                <Icon
                  kind={p.iconKind as "item" | "fluid" | "recipe"}
                  name={p.iconName}
                  size="sm"
                />
              ) : null}
              <span className="truncate">{p.blockName}</span>
              <span className="ml-auto text-muted-foreground">
                {p.role === "byproduct" ? "byproduct " : ""}
                {num(p.rate)}/s
              </span>
            </ContextMenuItem>
          ))}
        </>
      )}
      <div className="my-1 border-t border-border" />
      {/* the made-here link (#91): production covers consumption, imports
          forbidden, surplus exports. Marking without a producer flags the item
          as unmade until one is added. */}
      {made ? (
        <ContextMenuItem onClick={act(onUnmark)}>
          <Check className="size-3.5" /> Made in this block — click to import instead
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={act(onMark)}>
          <span className="inline-block size-3.5" />
          {producedInBlock ? "Make in this block (link production)" : "Require in-block production"}
        </ContextMenuItem>
      )}
      {spoilables[name] != null && (
        <>
          <div className="my-1 border-t border-border" />
          <ContextMenuItem onClick={act(onEditSpoil)}>
            <Timer className="size-3.5" />
            {spoilRate != null
              ? `Incidental spoilage ${num(spoilRate)}/s — edit`
              : "Estimate incidental spoilage…"}
          </ContextMenuItem>
          {spoilRate != null && (
            <ContextMenuItem onClick={act(onClearSpoil)}>
              <X className="size-3.5" /> Clear spoilage estimate
            </ContextMenuItem>
          )}
        </>
      )}
      <div className="my-1 border-t border-border" />
      <ContextMenuItem
        onClick={act(() => {
          locate.mutate({ name, kind: kind as "item" | "fluid" });
        })}
      >
        <MapPin className="size-3.5" /> Locate in game
      </ContextMenuItem>
    </ContextMenu>
  );
}
