import { useStore } from "@tanstack/react-store";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { AlertTriangle, GripVertical, Lock, Plus, Star, Timer, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { goalConsumes, STOCK_WINDOW_DEFAULT } from "../../lib/goals";
import { Icon } from "../../lib/icons";
import { EditableRate } from "./editable-rate.tsx";
import { ENERGY_PSEUDO, num } from "./format.ts";
import { EditableStock } from "./editable-stock.tsx";
import { LogiTag } from "./logi-tag.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { SortableGoal } from "./sortable-goal.tsx";
import { SupplyPriorityControl } from "./supply-priority-control.tsx";

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
  const supplyPriority = useStore(doc.store, (s) => s.supplyPriority ?? 0);
  const target = goals[0]?.name ?? "";
  const goalSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onGoalDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = goals.findIndex((g) => g.name === active.id);
    const to = goals.findIndex((g) => g.name === over.id);
    if (from < 0 || to < 0) return;
    doc.reorderGoals(arrayMove(goals, from, to));
    doc.note("Reorder goals");
  };
  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Goal</CardTitle>
        <SupplyPriorityControl
          value={supplyPriority}
          onChange={(priority) => {
            doc.setSupplyPriority(priority);
            doc.note("Set block supply priority");
          }}
        />
      </CardHeader>
      <CardContent className="space-y-2">
        <DndContext
          sensors={goalSensors}
          collisionDetection={closestCenter}
          onDragEnd={onGoalDragEnd}
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
            <SortableContext items={goals.map((g) => g.name)} strategy={rectSortingStrategy}>
              {goals.map((goal, i) => {
                const g = goal.name;
                const isFirst = i === 0;
                const consumes = goalConsumes(goal);
                const kind = kindOf(g);
                const goalMissing = res?.missing?.goods.includes(g) ?? false;
                const incidentalRate =
                  goal.rate > 0
                    ? (res?.incidentalSpoilage
                        .filter((spoilage) => spoilage.result === g)
                        .reduce((sum, spoilage) => sum + spoilage.rate, 0) ?? 0)
                    : 0;
                // declared but no recipe in the block makes/consumes it — fixable, not broken.
                // Suppressed on a broken block: the missing-refs banner already
                // explains why nothing's being made there.
                const goalUnmade =
                  !goalMissing && !res?.broken && (res?.unmade?.includes(g) ?? false);
                const extraText = goalMissing ? (
                  "No longer exists in the current data."
                ) : goalUnmade ? (
                  `No recipe in this block ${consumes ? "consumes" : "makes"} it. Click to add one.`
                ) : (
                  <div className="space-y-1">
                    <div>
                      {isFirst ? "Primary goal · names the block" : "Goal"} · right-click for
                      options
                    </div>
                    {incidentalRate > 0 && (
                      <div className="flex items-center gap-1 text-warning">
                        <Timer className="size-3.5" /> {num(incidentalRate)}/s estimated incidental
                        spoilage
                      </div>
                    )}
                  </div>
                );
                return (
                  <SortableGoal key={g} id={g}>
                    {({ setActivatorNodeRef, listeners, attributes, isDragging }) => (
                      <div
                        data-goal={g}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onGoalMenu(e, g);
                        }}
                        className={`group relative flex h-full min-w-16 flex-col items-center gap-0.5 px-2 py-1 ${
                          goalMissing
                            ? "bg-destructive/10 ring-1 ring-destructive/40"
                            : goalUnmade
                              ? "bg-warning/10 ring-1 ring-warning/40"
                              : isFirst
                                ? "bg-info/10 ring-1 ring-info/30"
                                : "bg-info/5 ring-1 ring-info/20"
                        } ${isDragging ? "shadow-lg ring-2 ring-primary" : ""}`}
                      >
                        {/* drag · move-to-front (not on the first goal) · remove — on hover */}
                        <Tooltip content="drag to reorder goals">
                          <button
                            ref={setActivatorNodeRef}
                            {...attributes}
                            {...listeners}
                            aria-label={`drag to reorder ${res?.display?.[g] ?? g}`}
                            className="absolute -top-2 -left-1.5 flex size-5 touch-none items-center justify-center bg-background text-muted-foreground opacity-0 shadow ring-1 ring-border group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing"
                          >
                            <GripVertical className="size-3" />
                          </button>
                        </Tooltip>
                        <div className="absolute -top-2 -right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                          {!isFirst && (
                            <button
                              onClick={() => doc.makePrimary(g)}
                              aria-label="move to front — name the block after this goal"
                              className="flex size-5 items-center justify-center bg-background text-info shadow ring-1 ring-border hover:brightness-125"
                            >
                              <Star className="size-3" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              doc.removeGoal(g);
                              // label the save for the undo stack (#90)
                              doc.note(`Remove goal "${res?.display?.[g] ?? g}"`);
                            }}
                            aria-label="remove this goal"
                            className="flex size-5 items-center justify-center bg-background text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => (consumes ? onUseFor(g) : onMakeFor(g))}
                          aria-label={`add a recipe that ${consumes ? "consumes" : "makes"} ${res?.display?.[g] ?? g}`}
                        >
                          <Icon kind={kind} name={g} size="lg" extraText={extraText} />
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
                              power={ENERGY_PSEUDO.has(g)}
                              onChange={(v) => {
                                doc.setGoalRate(g, v);
                                // label the save for the undo stack (#90)
                                doc.note(`Set "${res?.display?.[g] ?? g}" rate`);
                              }}
                              onUnitChange={(u) => doc.setGoalUnit(g, u)}
                            />
                          </span>
                        )}
                        {incidentalRate > 0 && (
                          <span
                            className="flex items-center gap-0.5 text-sm text-warning"
                            aria-label={`${num(incidentalRate)}/s estimated incidental spoilage`}
                          >
                            <Timer className="size-3" /> {num(incidentalRate)}/s
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
                            <Tooltip content="rates this small can fall below the solver's noise floor — flows may read as zero. If the intent is 'just make/keep some', a keep-in-stock goal (planned) will express that better than a tiny rate.">
                              <span className="flex cursor-help items-center gap-0.5 text-sm font-semibold text-warning">
                                <AlertTriangle className="size-3" /> very low rate
                              </span>
                            </Tooltip>
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
                        {/* supply-push note (#121): a count pin on this goal's producer
                    drives output — the goal rate no longer binds. Terse: a lock +
                    the pin's actual rate, colored amber when it falls short of the
                    target; the tooltip carries the full explanation. */}
                        {(() => {
                          const ss = res?.goalSuperseded?.find((x) => x.item === g);
                          if (!ss) return null;
                          const short = ss.actualRate < ss.goalRate - 1e-9;
                          return (
                            <Tooltip
                              content={`Pinned to ${ss.pinnedCount} building${ss.pinnedCount === 1 ? "" : "s"} — the count drives output, so the ${num(ss.goalRate)}/s target no longer binds.${short ? ` Reaching it would take ${ss.buildingsForGoal} buildings.` : ""}`}
                            >
                              <span
                                className={`flex items-center gap-0.5 text-sm ${short ? "text-warning" : "text-info"}`}
                              >
                                <Lock className="size-3" /> {num(ss.actualRate)}/s
                              </span>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    )}
                  </SortableGoal>
                );
              })}
            </SortableContext>
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
        </DndContext>
        {!target && (
          <div className="text-sm text-muted-foreground">
            Pick a goal product to size this block.
          </div>
        )}
        {lockedInput && (
          <Tooltip content="edit the locked rate in Imports, or unlock it there">
            <div className="flex items-center gap-1 text-sm text-info">
              <Lock className="size-3 shrink-0" /> sized by input
            </div>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
}
