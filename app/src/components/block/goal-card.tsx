import { useStore } from "@tanstack/react-store";
import { AlertTriangle, Lock, Plus, Star, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { STOCK_WINDOW_DEFAULT } from "../../lib/goals";
import { Icon } from "../../lib/icons";
import { EditableRate } from "./editable-rate.tsx";
import { EditableStock } from "./editable-stock.tsx";
import { LogiTag } from "./logi-tag.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";

/** The Goal card: goals as compact stacked cells (icon over rate) so many fit —
 * a block can target several products at once. Each goal has a target rate (a
 * solver target); click the rate to edit it, the icon to add a recipe that makes
 * it, right-click for options. goals[0] names the block + anchors the
 * rate-scaling tools; ★ moves a goal to the front. */
export function GoalCard({
  doc,
  res,
  kindOf,
  lockedInput,
  logi,
  onGoalMenu,
  onMakeFor,
  onUseFor,
  onOpenGoalPicker,
}: {
  doc: BlockDocStore;
  res: SolveResult | undefined;
  kindOf: (name: string) => "item" | "fluid";
  /** import currently sizing the block (goal rate is read-only while locked) */
  lockedInput: string | null;
  logi: LogiView;
  onGoalMenu: (e: { clientX: number; clientY: number }, name: string) => void;
  onMakeFor: (name: string) => void;
  onUseFor: (name: string) => void;
  onOpenGoalPicker: () => void;
}) {
  const goals = useStore(doc.store, (s) => s.goals);
  const target = goals[0]?.name ?? "";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Goal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {goals.map((goal, i) => {
            const g = goal.name;
            const isFirst = i === 0;
            const kind = kindOf(g);
            const goalMissing = res?.missing?.goods.includes(g) ?? false;
            // declared but no recipe in the block makes it — fixable, not broken.
            // Suppressed on a broken block: the missing-refs banner already
            // explains why nothing's being made there.
            const goalUnmade =
              !goalMissing && !res?.broken && (res?.unmadeTargets?.includes(g) ?? false);
            return (
              <div
                key={g}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onGoalMenu(e, g);
                }}
                className={`group relative flex min-w-16 flex-col items-center gap-0.5 px-2 py-1 ${
                  goalMissing
                    ? "bg-destructive/10 ring-1 ring-destructive/40"
                    : goalUnmade
                      ? "bg-warning/10 ring-1 ring-warning/40"
                      : isFirst
                        ? "bg-info/10 ring-1 ring-info/30"
                        : "bg-info/5 ring-1 ring-info/20"
                }`}
                title={
                  goalMissing
                    ? `${g} — no longer exists in the current data`
                    : goalUnmade
                      ? `${res?.display?.[g] ?? g} — no recipe in this block makes it. Click the icon to add one.`
                      : `${res?.display?.[g] ?? g}${isFirst ? " — names the block" : ""} · right-click for options`
                }
              >
                {/* move-to-front (not on the first goal) · remove — on hover */}
                <div className="absolute -top-2 -right-1.5 flex gap-1 opacity-0 group-hover:opacity-100">
                  {!isFirst && (
                    <button
                      onClick={() => doc.makePrimary(g)}
                      title="move to front — name the block after this goal"
                      className="flex size-5 items-center justify-center bg-background text-info shadow ring-1 ring-border hover:brightness-125"
                    >
                      <Star className="size-3" />
                    </button>
                  )}
                  <button
                    onClick={() => doc.removeGoal(g)}
                    title="remove this goal"
                    className="flex size-5 items-center justify-center bg-background text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <button
                  onClick={() => (isFirst && goal.rate < 0 ? onUseFor(g) : onMakeFor(g))}
                  title="click to add a recipe that makes this goal (right-click to change the item)"
                >
                  <Icon kind={kind} name={g} size="lg" title={res?.display?.[g] ?? g} />
                </button>
                {goalMissing ? (
                  <span className="flex items-center gap-0.5 text-sm font-semibold text-destructive">
                    <AlertTriangle className="size-3" /> gone
                  </span>
                ) : goal.stock != null ? (
                  <span className="text-sm">
                    <EditableStock
                      stock={goal.stock}
                      window={goal.window ?? STOCK_WINDOW_DEFAULT}
                      onChange={(n) => doc.setGoalStock(g, n)}
                      onWindowChange={(w) => doc.setGoalWindow(g, w)}
                    />
                  </span>
                ) : (
                  <span className="text-sm">
                    <EditableRate
                      value={goal.rate}
                      unit={goal.unit ?? "s"}
                      readOnly={isFirst && !!lockedInput}
                      onChange={(v) => doc.setGoalRate(g, v)}
                      onUnitChange={(u) => doc.setGoalUnit(g, u)}
                    />
                  </span>
                )}
                {goalUnmade && (
                  <span className="flex items-center gap-0.5 text-sm font-semibold text-warning">
                    <AlertTriangle className="size-3" /> no recipe
                  </span>
                )}
                {/* Rates near the solver's noise floor (flows under 1e-6/s read as
                    zero) solve unreliably — and are usually a proxy for "just keep
                    some around", which is a stock goal's job (#38), not a rate's. */}
                {!goalMissing &&
                  goal.stock == null &&
                  goal.rate !== 0 &&
                  Math.abs(goal.rate) < 1e-4 && (
                    <span
                      className="flex cursor-help items-center gap-0.5 text-sm font-semibold text-warning"
                      title="rates this small can fall below the solver's noise floor — flows may read as zero. If the intent is 'just make/keep some', a keep-in-stock goal (planned) will express that better than a tiny rate."
                    >
                      <AlertTriangle className="size-3" /> very low rate
                    </span>
                  )}
                {logi.resolved && kind === "item" && !goalMissing && (
                  <LogiTag
                    resolved={logi.resolved}
                    rate={Math.abs(goal.rate)}
                    machineCount={0}
                    showBelts={logi.showBelts}
                    showInserters={logi.showInserters}
                    launch={logi.launchInfo(g, Math.abs(goal.rate))}
                  />
                )}
              </div>
            );
          })}
          {/* add a goal */}
          <button
            onClick={onOpenGoalPicker}
            title="add a goal product"
            className="flex min-w-16 flex-col items-center justify-center gap-0.5 border border-dashed border-border px-2 py-1 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-6" />
            <span className="text-sm">goal</span>
          </button>
        </div>
        {!target && (
          <div className="text-sm text-muted-foreground">
            Pick a goal product to size this block.
          </div>
        )}
        {lockedInput && (
          <div className="flex items-center gap-1 text-sm text-info">
            <Lock className="size-3 shrink-0" /> sized by input — edit the locked rate in Imports,
            or unlock it there
          </div>
        )}
      </CardContent>
    </Card>
  );
}
