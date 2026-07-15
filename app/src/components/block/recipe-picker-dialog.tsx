import { Check, FlaskConical, Lock } from "lucide-react";
import type { recipeCandidatesFn } from "../../server/factorio";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { TechLine } from "../../lib/recipe-card";
import { Icon } from "../../lib/icons";
import { RecipeIoChips } from "./recipe-io-chips.tsx";
import { fmtCost } from "./format.ts";

type Candidate = Awaited<ReturnType<typeof recipeCandidatesFn>>[number];

/** Recipe picker — current unlocks first, then horizon choices and locked rows,
 * with cost ordering inside each group. Floats over everything. */
export function RecipePickerDialog({
  mode,
  goodDisplay,
  candidates,
  added,
  onAdd,
  onClose,
}: {
  mode: "produce" | "consume";
  goodDisplay: string;
  candidates: Candidate[] | undefined;
  /** recipes already in the block (selecting one links the clicked good) */
  added: string[];
  onAdd: (recipe: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {mode === "consume" ? "Recipes that consume" : "Recipes that make"} {goodDisplay}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {candidates?.length ? (
            candidates.map((r, index) => {
              const isAdded = added.includes(r.name);
              const locked = !r.selectable && !r.superseded;
              const previous = candidates[index - 1];
              const group = r.unlockedNow ? "now" : r.selectable ? "horizon" : "locked";
              const previousGroup = previous
                ? previous.unlockedNow
                  ? "now"
                  : previous.selectable
                    ? "horizon"
                    : "locked"
                : null;
              const beginsGroup = group !== previousGroup;
              const machines = r.machineAvailability.options;
              const availableMachine =
                machines.find((machine) => machine.availableNow) ?? machines[0];
              const lockedMachine = machines.find((machine) => !machine.availableNow);
              return (
                <div key={r.name}>
                  {beginsGroup && (
                    <div
                      className={`px-3 pt-3 pb-1 text-sm font-semibold ${group === "locked" ? "text-destructive" : "text-success"}`}
                    >
                      {group === "now"
                        ? "Unlocked now"
                        : group === "horizon"
                          ? r.horizonMode === "now"
                            ? "Available with current science"
                            : "Available in planning horizon"
                          : "Locked or unavailable"}
                    </div>
                  )}
                  <button
                    data-recipe-candidate={r.name}
                    className={`flex w-full items-start gap-3 border px-3 py-2.5 text-left ${
                      locked
                        ? "cursor-not-allowed border-destructive/70 bg-destructive/10 opacity-70"
                        : r.superseded
                          ? "cursor-not-allowed border-border opacity-55"
                          : "border-transparent hover:bg-muted"
                    }`}
                    onClick={() => {
                      if (!locked && !r.superseded) onAdd(r.name);
                    }}
                    aria-disabled={locked || !!r.superseded}
                  >
                    <Icon kind="recipe" name={r.name} size="lg" noTitle />
                    <span className="min-w-0 flex-1 space-y-1">
                      {/* full name — wraps instead of truncating */}
                      <span className="flex items-baseline gap-3">
                        <span className="text-base">{r.display ?? r.name}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-2">
                          {r.cost != null && (
                            <Tooltip content="Estimated cost per craft (cost analysis) — sorted cheapest first within each availability group">
                              <span className="text-sm text-muted-foreground">
                                ¥{fmtCost(r.cost)}
                              </span>
                            </Tooltip>
                          )}
                          {isAdded && (
                            <span className="text-sm text-muted-foreground">
                              Added · select to link
                            </span>
                          )}
                        </span>
                      </span>
                      {/* io at a glance — hover any icon for the item card */}
                      <RecipeIoChips ingredients={r.ingredients} products={r.products} />
                      {/* Combined recipe + building availability. Synthetic power
                        recipes are start-enabled, so their building is the real
                        research gate. */}
                      {r.superseded ? (
                        <Tooltip
                          content={`Your ${r.superseded.masterDisplay ?? "TURD"} choice "${r.superseded.subDisplay}" replaced this recipe with "${r.superseded.newDisplay}" — the base version no longer exists in-game`}
                        >
                          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon kind="technology" name={r.superseded.subTech} size="sm" noTitle />
                            <FlaskConical className="size-3.5" /> Replaced by{" "}
                            {r.superseded.newDisplay}
                            <span className="text-muted-foreground/70">
                              ({r.superseded.masterDisplay ?? "TURD"} › {r.superseded.subDisplay})
                            </span>
                          </span>
                        </Tooltip>
                      ) : r.turd && !r.enabled ? (
                        <Tooltip
                          content={
                            r.turd.turdSelected
                              ? "Granted by your selected TURD choice"
                              : `Requires the "${r.turd.display}" choice under "${r.turd.masterDisplay ?? "TURD"}" — pick it on the TURD page (or in-game TURD explorer)`
                          }
                        >
                          <span
                            className={`flex flex-wrap items-center gap-1.5 text-sm ${r.turd.turdSelected ? "text-success" : "text-primary"}`}
                          >
                            <Icon kind="technology" name={r.turd.tech} size="sm" noTitle />
                            <FlaskConical className="size-3.5" />{" "}
                            {r.turd.masterDisplay ? `${r.turd.masterDisplay} › ` : ""}
                            {r.turd.display}
                            {r.turd.turdSelected && <Check className="size-3.5" />}
                          </span>
                        </Tooltip>
                      ) : !r.enabled && r.unlocks.length ? (
                        <TechLine
                          unlock={r.unlocks[0]}
                          more={r.unlocks.length - 1}
                          researched={r.avail.research === "available"}
                        />
                      ) : !r.enabled ? (
                        <Tooltip content="No technology unlocks this recipe">
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Lock className="size-3.5" /> Locked
                          </span>
                        </Tooltip>
                      ) : null}
                      {!r.superseded && !r.machineAvailability.available && lockedMachine && (
                        <Tooltip
                          content={`${lockedMachine.display ?? lockedMachine.name} is not unlocked under the current planning horizon${lockedMachine.unlockedBy.length ? `; requires ${lockedMachine.unlockedBy.map((unlock) => unlock.display ?? unlock.tech).join(" or ")}` : ""}`}
                        >
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-destructive">
                            <Lock className="size-3.5 shrink-0" /> Building locked ·{" "}
                            {lockedMachine.display ?? lockedMachine.name}
                            {lockedMachine.unlockedBy.length > 0 && (
                              <>
                                {" "}
                                <span className="font-normal">
                                  · Needs{" "}
                                  {lockedMachine.unlockedBy[0].display ??
                                    lockedMachine.unlockedBy[0].tech}
                                  {lockedMachine.unlockedBy.length > 1
                                    ? ` (+${lockedMachine.unlockedBy.length - 1} alternative)`
                                    : ""}
                                </span>
                              </>
                            )}
                          </span>
                        </Tooltip>
                      )}
                      {r.selectable && (
                        <span className="flex items-center gap-1 text-sm text-success">
                          <Check className="size-3.5 shrink-0" />
                          {r.unlockedNow
                            ? "Unlocked now"
                            : r.horizonMode === "now"
                              ? "Available with current science"
                              : "Available in horizon"}
                          {availableMachine &&
                            ` · ${availableMachine.display ?? availableMachine.name}`}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              {mode === "consume"
                ? "Nothing consumes this in the data"
                : "No recipes make this — it's a raw input"}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
