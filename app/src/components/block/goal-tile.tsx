import { memo } from "react";
import { AlertTriangle, GripVertical, Lock, Star, Timer, X } from "lucide-react";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import type { Goal, TemporaryCampaign } from "../../db/schema";
import { goalConsumes, STOCK_WINDOW_DEFAULT } from "../../lib/goals";
import { Icon } from "../../lib/icons";
import { countRender } from "../../lib/render-count.ts";
import { campaignGoalQuantity } from "../../lib/campaign.ts";
import { EditableRate } from "./editable-rate.tsx";
import { ENERGY_PSEUDO, num } from "./format.ts";
import { EditableStock } from "./editable-stock.tsx";
import { EditableCampaignQuantity } from "./editable-campaign-quantity.tsx";
import { LogiTag } from "./logi-tag.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { SortableGoal } from "./sortable-goal.tsx";
import { FluidTemperaturePicker } from "./fluid-temperature-picker.tsx";

/** One goal of the Goal card: icon over rate, with hover controls (drag,
 * move to front, remove) and the goal's warnings and logistics readout.
 *
 * Memoized (#154): an edit re-renders only the tiles whose props changed, so
 * the card passes primitives or solve parts the editor keeps reference-stable,
 * and stable callbacks. */
export const GoalTile = memo(function GoalTile({
  doc,
  goal,
  isFirst,
  kind,
  display,
  missing,
  unmade,
  incidentalRate,
  temperatureChoice,
  superseded,
  solvedRate,
  campaign,
  rateLocked,
  logi,
  onGoalMenu,
  onMakeFor,
  onUseFor,
  onQuickRecipeFor,
}: {
  doc: BlockDocStore;
  goal: Goal;
  /** the primary goal: names the block, anchors the rate-scaling tools */
  isFirst: boolean;
  kind: "item" | "fluid";
  display: string;
  /** the good no longer exists in the current data */
  missing: boolean;
  /** declared, but no recipe in the block makes/consumes it */
  unmade: boolean;
  /** estimated incidental spoilage that lands on this goal, per second */
  incidentalRate: number;
  temperatureChoice: NonNullable<SolveResult["goalTemperatureChoices"]>[string] | undefined;
  /** a count pin on the goal's producer drives output instead of the goal rate (#121) */
  superseded: NonNullable<SolveResult["goalSuperseded"]>[number] | undefined;
  /** the solved flow: a consume goal's import, else what the goal sends out */
  solvedRate: number;
  campaign: TemporaryCampaign | null | undefined;
  /** the rate is read-only while an import sizes the block */
  rateLocked: boolean;
  logi: LogiView;
  onGoalMenu: (e: { clientX: number; clientY: number }, name: string) => void;
  onMakeFor: (name: string) => void;
  onUseFor: (name: string) => void;
  onQuickRecipeFor: (name: string, mode: "produce" | "consume") => void;
}) {
  const g = goal.name;
  countRender(`goal:${g}`);
  const consumes = goalConsumes(goal);
  // a superseding pin that falls short of the goal rate
  const short = !!superseded && superseded.actualRate < superseded.goalRate - 1e-9;
  const extraText = missing ? (
    "No longer exists in the current data."
  ) : unmade ? (
    `No recipe in this block ${consumes ? "consumes" : "makes"} it. Click to choose one, or Ctrl+Click to add the best unlocked non-barreling recipe.`
  ) : (
    <div className="space-y-1">
      <div>{isFirst ? "Primary goal · names the block" : "Goal"} · right-click for options</div>
      <div className="text-muted-foreground">
        Ctrl+Click · add best unlocked non-barreling recipe
      </div>
      {incidentalRate > 0 && (
        <div className="flex items-center gap-1 text-warning">
          <Timer className="size-3.5" /> {num(incidentalRate)}/s estimated incidental spoilage
        </div>
      )}
    </div>
  );
  return (
    <SortableGoal id={g}>
      {({ setActivatorNodeRef, listeners, attributes, isDragging }) => (
        <div
          data-goal={g}
          data-context-menu
          onContextMenu={(e) => {
            e.preventDefault();
            onGoalMenu(e, g);
          }}
          className={`group relative flex h-full min-w-16 flex-col items-center gap-0.5 px-2 py-1 ${
            missing
              ? "bg-destructive/10 ring-1 ring-destructive/40"
              : unmade
                ? "bg-warning/10 ring-1 ring-warning/40"
                : isFirst
                  ? "bg-info/10 ring-1 ring-info/30"
                  : "bg-info/5 ring-1 ring-info/20"
          } ${isDragging ? "shadow-lg ring-2 ring-primary" : ""}`}
        >
          {/* drag · move-to-front (not on the first goal) · remove — on hover */}
          <Tooltip content="Drag to reorder goals">
            <button
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Drag to reorder ${display}`}
              className="absolute -top-2 -left-1.5 flex size-5 touch-none items-center justify-center bg-background text-muted-foreground opacity-0 shadow ring-1 ring-border group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing"
            >
              <GripVertical className="size-3" />
            </button>
          </Tooltip>
          <div className="absolute -top-2 -right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {!isFirst && (
              <button
                onClick={() => doc.makePrimary(g)}
                aria-label="Move to front — name the block after this goal"
                className="flex size-5 items-center justify-center bg-background text-info shadow ring-1 ring-border hover:brightness-125"
              >
                <Star className="size-3" />
              </button>
            )}
            <button
              onClick={() => {
                doc.removeGoal(g);
                // label the save for the undo stack (#90)
                doc.note(`Remove goal "${display}"`);
              }}
              aria-label="Remove this goal"
              className="flex size-5 items-center justify-center bg-background text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </div>
          <button
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey) {
                onQuickRecipeFor(g, consumes ? "consume" : "produce");
                return;
              }
              if (consumes) onUseFor(g);
              else onMakeFor(g);
            }}
            aria-label={`Add a recipe that ${consumes ? "consumes" : "makes"} ${display}`}
          >
            <Icon kind={kind} name={g} size="lg" extraText={extraText} />
          </button>
          {missing ? (
            <span className="flex items-center gap-0.5 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-3" /> Gone
            </span>
          ) : campaign ? (
            <span className="text-sm">
              <EditableCampaignQuantity
                quantity={campaignGoalQuantity(campaign, goal)}
                onChange={(quantity) => {
                  doc.setCampaignQuantity(g, quantity);
                  doc.note(`Set "${display}" campaign quantity`);
                }}
              />
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
                readOnly={rateLocked}
                power={ENERGY_PSEUDO.has(g)}
                onChange={(v) => {
                  doc.setGoalRate(g, v);
                  // label the save for the undo stack (#90)
                  doc.note(`Set "${display}" rate`);
                }}
                onUnitChange={(u) => doc.setGoalUnit(g, u)}
              />
            </span>
          )}
          {temperatureChoice && (
            <FluidTemperaturePicker
              scope="goal"
              fluid={g}
              display={display}
              accepted={temperatureChoice.acceptedTemperature}
              selected={temperatureChoice.selectedTemperature}
              favorite={temperatureChoice.favoriteTemperature}
              options={temperatureChoice.temperatureOptions}
              onChange={(temperature) => {
                doc.setGoalTemperature(g, temperature);
                doc.note(
                  temperature == null
                    ? `Use ${temperatureChoice.acceptedTemperature} ${display} goal`
                    : `Use ${temperature}°C ${display} goal`,
                );
              }}
            />
          )}
          {incidentalRate > 0 && (
            <span
              className="flex items-center gap-0.5 text-sm text-warning"
              aria-label={`${num(incidentalRate)}/s estimated incidental spoilage`}
            >
              <Timer className="size-3" /> {num(incidentalRate)}/s
            </span>
          )}
          {unmade && (
            <span className="flex items-center gap-0.5 text-sm font-semibold text-warning">
              <AlertTriangle className="size-3" /> No recipe
            </span>
          )}
          {/* Rates near the solver's noise floor (flows under 1e-6/s read as
              zero) solve unreliably — and are usually a proxy for "just keep
              some around", which is a stock goal's job (#38), not a rate's. */}
          {!missing &&
            goal.stock == null &&
            !campaign &&
            goal.rate !== 0 &&
            Math.abs(goal.rate) < 1e-4 && (
              <Tooltip content="Rates this small can fall below the solver's noise floor — flows may read as zero. If the intent is 'just make/keep some', a keep-in-stock goal (planned) will express that better than a tiny rate.">
                <span className="flex cursor-help items-center gap-0.5 text-sm font-semibold text-warning">
                  <AlertTriangle className="size-3" /> Very low rate
                </span>
              </Tooltip>
            )}
          {logi.resolved && kind === "item" && !missing && !campaign && (
            <LogiTag
              resolved={logi.resolved}
              rate={Math.abs(goal.rate)}
              machineCount={0}
              direction="output"
              showBelts={logi.showBelts}
              showInserters={logi.showInserters}
              launch={logi.launchInfo(g, Math.abs(goal.rate))}
              robots={logi.robotsFor({ name: g, kind, rate: solvedRate })}
            />
          )}
          {/* supply-push note (#121): a count pin on this goal's producer
              drives output — the goal rate no longer binds. Terse: a lock +
              the pin's actual rate, colored amber when it falls short of the
              target; the tooltip carries the full explanation. */}
          {superseded && (
            <Tooltip
              content={`Pinned to ${superseded.pinnedCount} building${superseded.pinnedCount === 1 ? "" : "s"} — the count drives output, so the ${num(superseded.goalRate)}/s target no longer binds.${short ? ` Reaching it would take ${superseded.buildingsForGoal} buildings.` : ""}`}
            >
              <span
                className={`flex items-center gap-0.5 text-sm ${short ? "text-warning" : "text-info"}`}
              >
                <Lock className="size-3" /> {num(superseded.actualRate)}/s
              </span>
            </Tooltip>
          )}
        </div>
      )}
    </SortableGoal>
  );
});
