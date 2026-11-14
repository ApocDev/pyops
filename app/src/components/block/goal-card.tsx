import { memo, useMemo } from "react";
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
import { Lock, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { goalConsumes } from "../../lib/goals";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { GoalTile } from "./goal-tile.tsx";
import { SupplyPriorityControl } from "./supply-priority-control.tsx";
import { GoalClipboardActions } from "./goal-clipboard-actions.tsx";
import { TemporaryCampaignControls } from "./temporary-campaign-controls.tsx";

// Stable sensor options: new objects each render would hand dnd-kit new
// activators, which re-renders every sortable tile.
const POINTER = { activationConstraint: { distance: 4 } };
const KEYBOARD = { coordinateGetter: sortableKeyboardCoordinates };

/** The Goal card: goals as compact stacked cells (icon over rate) so many fit —
 * a block can target several products at once. Each goal has a target rate (a
 * solver target); click the rate to edit it, the icon to add a recipe that makes
 * it, right-click for options. goals[0] names the block + anchors the
 * rate-scaling tools; ★ moves a goal to the front.
 *
 * Memoized with its tiles (#154): the editor keeps every prop reference-stable,
 * so an edit re-renders only the tiles whose goal or solved numbers changed. */
export const GoalCard = memo(function GoalCard({
  doc,
  res,
  kindOf,
  lockedInput,
  logi,
  onGoalMenu,
  onMakeFor,
  onUseFor,
  onQuickRecipeFor,
  onOpenGoalPicker,
  blockEnabled,
  onCompleteCampaign,
  onReactivateCampaign,
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
  onQuickRecipeFor: (name: string, mode: "produce" | "consume") => void;
  onOpenGoalPicker: () => void;
  blockEnabled: boolean;
  onCompleteCampaign: () => void;
  onReactivateCampaign: () => void;
}) {
  const goals = useStore(doc.store, (s) => s.goals);
  const campaign = useStore(doc.store, (s) => s.campaign);
  const supplyPriority = useStore(doc.store, (s) => s.supplyPriority ?? 0);
  const target = goals[0]?.name ?? "";
  const goalSensors = useSensors(
    useSensor(PointerSensor, POINTER),
    useSensor(KeyboardSensor, KEYBOARD),
  );
  // A new ids array re-renders every sortable tile, so key it on the names: a
  // rate edit makes a new goals array with the same ids.
  const goalKey = goals.map((g) => g.name).join("\n");
  const goalIds = useMemo(() => (goalKey ? goalKey.split("\n") : []), [goalKey]);
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
        <div className="flex items-center gap-1">
          <TemporaryCampaignControls
            doc={doc}
            blockEnabled={blockEnabled}
            onComplete={onCompleteCampaign}
            onReactivate={onReactivateCampaign}
          />
          <GoalClipboardActions
            goals={goals}
            onPaste={(copied) => {
              const result = doc.appendGoals(copied);
              if (result.added)
                doc.note(`Paste ${result.added} goal${result.added === 1 ? "" : "s"}`);
              return result;
            }}
          />
          <SupplyPriorityControl
            value={supplyPriority}
            onChange={(priority) => {
              doc.setSupplyPriority(priority);
              doc.note("Set block supply priority");
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <DndContext
          sensors={goalSensors}
          collisionDetection={closestCenter}
          onDragEnd={onGoalDragEnd}
        >
          <div className="grid auto-rows-max grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
            <SortableContext items={goalIds} strategy={rectSortingStrategy}>
              {goals.map((goal, i) => {
                const g = goal.name;
                const goalMissing = res?.missing?.goods.includes(g) ?? false;
                return (
                  <GoalTile
                    key={g}
                    doc={doc}
                    goal={goal}
                    isFirst={i === 0}
                    kind={kindOf(g)}
                    display={res?.display?.[g] ?? g}
                    missing={goalMissing}
                    // declared but no recipe in the block makes/consumes it — fixable,
                    // not broken. Suppressed on a broken block: the missing-refs
                    // banner already explains why nothing's being made there.
                    unmade={!goalMissing && !res?.broken && (res?.unmade?.includes(g) ?? false)}
                    incidentalRate={
                      goal.rate > 0
                        ? (res?.incidentalSpoilage
                            .filter((spoilage) => spoilage.result === g)
                            .reduce((sum, spoilage) => sum + spoilage.rate, 0) ?? 0)
                        : 0
                    }
                    temperatureChoice={res?.goalTemperatureChoices?.[g]}
                    superseded={res?.goalSuperseded?.find((x) => x.item === g)}
                    // a consume goal's import, else what the goal actually sends
                    // out (0 once a pin supersedes it)
                    solvedRate={
                      (goalConsumes(goal) ? res?.imports : res?.goalOutputs)?.find(
                        (flow) => flow.name === g,
                      )?.rate ?? 0
                    }
                    campaign={campaign}
                    rateLocked={i === 0 && !!lockedInput}
                    logi={logi}
                    onGoalMenu={onGoalMenu}
                    onMakeFor={onMakeFor}
                    onUseFor={onUseFor}
                    onQuickRecipeFor={onQuickRecipeFor}
                  />
                );
              })}
            </SortableContext>
            {/* add a goal */}
            <button
              onClick={onOpenGoalPicker}
              title="Add a goal product"
              className="flex min-w-16 flex-col items-center justify-center gap-0.5 border border-dashed border-border px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-6" />
              <span className="text-sm">Goal</span>
            </button>
          </div>
        </DndContext>
        {!target && (
          <div className="text-sm text-muted-foreground">
            Pick a goal product to size this block.
          </div>
        )}
        {lockedInput && (
          <Tooltip content="Edit the locked rate in Imports, or unlock it there">
            <div className="flex items-center gap-1 text-sm text-info">
              <Lock className="size-3 shrink-0" /> Sized by input
            </div>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
});
