import { Check, FlaskConical, Lock } from "lucide-react";
import type { recipeCandidatesFn } from "../../server/factorio";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { TechLine } from "../../lib/recipe-card";
import { Icon } from "../../lib/icons";
import { RecipeIoChips } from "./recipe-io-chips.tsx";
import { fmtCost } from "./format.ts";

type Candidate = Awaited<ReturnType<typeof recipeCandidatesFn>>[number];

/** Recipe picker — the candidates that make/consume a good, availability-sorted,
 * with io at a glance and TURD/tech lock state. Floats over everything. */
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
  /** recipes already in the block (their rows disable) */
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
            candidates.map((r) => {
              const isAdded = added.includes(r.name);
              return (
                <button
                  key={r.name}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted ${
                    r.enabled || r.turd?.turdSelected ? "" : "opacity-70"
                  }`}
                  onClick={() => onAdd(r.name)}
                  disabled={isAdded}
                >
                  <Icon kind="recipe" name={r.name} size="lg" noTitle />
                  <span className="min-w-0 flex-1 space-y-1">
                    {/* full name — wraps instead of truncating */}
                    <span className="flex items-baseline gap-3">
                      <span className="text-base">{r.display ?? r.name}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {r.cost != null && (
                          <span
                            className="text-sm text-muted-foreground"
                            title="estimated cost per craft (cost analysis) — sorted cheapest first"
                          >
                            ¥{fmtCost(r.cost)}
                          </span>
                        )}
                        {isAdded && <span className="text-sm text-muted-foreground">added</span>}
                      </span>
                    </span>
                    {/* io at a glance — hover any icon for the item card */}
                    <RecipeIoChips ingredients={r.ingredients} products={r.products} />
                    {/* availability: TURD choice / not-yet-researched tech (red) /
                        nothing unlocks it (dark gray) */}
                    {r.superseded ? (
                      <span
                        className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
                        title={`your ${r.superseded.masterDisplay ?? "TURD"} choice "${r.superseded.subDisplay}" replaced this recipe with "${r.superseded.newDisplay}" — the base version no longer exists in-game`}
                      >
                        <Icon kind="technology" name={r.superseded.subTech} size="sm" noTitle />
                        <FlaskConical className="size-3.5" /> replaced by {r.superseded.newDisplay}
                        <span className="text-muted-foreground/70">
                          ({r.superseded.masterDisplay ?? "TURD"} › {r.superseded.subDisplay})
                        </span>
                      </span>
                    ) : (
                      !r.enabled &&
                      (r.turd ? (
                        <span
                          className={`flex flex-wrap items-center gap-1.5 text-sm ${r.turd.turdSelected ? "text-success" : "text-primary"}`}
                          title={
                            r.turd.turdSelected
                              ? "granted by your selected TURD choice"
                              : `requires the "${r.turd.display}" choice under "${r.turd.masterDisplay ?? "TURD"}" — pick it on the TURD page (or in-game TURD explorer)`
                          }
                        >
                          <Icon kind="technology" name={r.turd.tech} size="sm" noTitle />
                          <FlaskConical className="size-3.5" />{" "}
                          {r.turd.masterDisplay ? `${r.turd.masterDisplay} › ` : ""}
                          {r.turd.display}
                          {r.turd.turdSelected && <Check className="size-3.5" />}
                        </span>
                      ) : r.unlocks.length ? (
                        <TechLine
                          unlock={r.unlocks[0]}
                          more={r.unlocks.length - 1}
                          researched={r.avail.research === "available"}
                        />
                      ) : (
                        <span
                          className="flex items-center gap-1 text-sm text-muted-foreground"
                          title="no technology unlocks this recipe"
                        >
                          <Lock className="size-3.5" /> locked
                        </span>
                      ))
                    )}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              {mode === "consume"
                ? "nothing consumes this in the data"
                : "no recipes make this — it's a raw input"}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
