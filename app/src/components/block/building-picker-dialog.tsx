import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Grid2x2, Lock, Star, Zap } from "lucide-react";
import { machineOptionsFn, setFavoriteMachineFn } from "../../server/factorio";
import { Badge } from "#/components/ui/badge.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Icon } from "../../lib/icons";
import { fmtW } from "./format.ts";
import { rowBtn } from "./styles.ts";

/** Building picker — choose which machine runs a recipe (speed / power / tier),
 * with unlock state and the per-category favorite star (#18). Owns its options
 * query; favorites are app-level prefs, so toggling one only refetches here. */
export function BuildingPickerDialog({
  recipe,
  recipeDisplay,
  current,
  onPick,
  onClose,
}: {
  recipe: string;
  recipeDisplay: string;
  /** the machine the current solve uses for this recipe */
  current: string | null;
  onPick: (machine: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const machineOpts = useQuery({
    queryKey: ["machineOpts", recipe],
    queryFn: () => machineOptionsFn({ data: recipe }),
  });
  const toggleFavorite = (machine: string, isFav: boolean) => {
    void setFavoriteMachineFn({ data: { recipe, machine: isFav ? null : machine } }).then(() => {
      void qc.invalidateQueries({ queryKey: ["machineOpts"] });
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[36rem]">
        <DialogHeader>
          <DialogTitle className="truncate">Building for {recipeDisplay}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {machineOpts.isLoading && (
            <div className="space-y-1.5 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-3/4" />
            </div>
          )}
          {machineOpts.data
            ?.slice()
            .sort((a, b) => (a.craftingSpeed ?? 0) - (b.craftingSpeed ?? 0))
            .map((m) => {
              const cur = current === m.name;
              return (
                <button
                  key={m.name}
                  className={`${rowBtn} w-full items-start ${cur ? "bg-accent" : ""} ${m.availableNow ? "" : "opacity-55"}`}
                  onClick={() => onPick(m.name)}
                >
                  <Icon kind="item" name={m.name} size="md" noTitle />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground">{m.display ?? m.name}</span>
                      <Badge variant="secondary">{m.craftingSpeed}× speed</Badge>
                      {m.energySource === "electric" && (
                        <span className="flex items-center gap-1 text-sm text-info">
                          <Zap className="size-3" /> {fmtW(m.energyUsageW ?? 0)}
                        </span>
                      )}
                      {(m.energySource === "burner" || m.energySource === "fluid") && (
                        <span className="flex items-center gap-1 text-sm text-warning">
                          <Flame className="size-3" /> {fmtW(m.energyUsageW ?? 0)}
                        </span>
                      )}
                      {m.energySource === "heat" && (
                        <span className="flex items-center gap-1 text-sm">
                          <Flame className="size-3" /> heat
                        </span>
                      )}
                      {m.moduleSlots > 0 && (
                        <span className="flex items-center gap-0.5 text-sm text-muted-foreground">
                          {m.moduleSlots}
                          <Grid2x2 className="size-3" />
                        </span>
                      )}
                      {cur && <span className="text-sm text-primary">· current</span>}
                      <span
                        role="button"
                        tabIndex={-1}
                        title={
                          m.favorite
                            ? "Favorite building for this category — new recipes here use it. Click to clear."
                            : "Set as the favorite building for this category (new recipes here will use it)"
                        }
                        className={`ml-auto cursor-pointer text-sm ${m.favorite ? "text-warning" : "text-muted-foreground hover:text-warning"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(m.name, m.favorite);
                        }}
                      >
                        <Star className="size-4" fill={m.favorite ? "currentColor" : "none"} />
                      </span>
                    </span>
                    <span className="block truncate text-sm">
                      {m.availableNow ? (
                        <span className="flex items-center gap-1 text-success/80">
                          <Check className="size-3 shrink-0" />
                          {m.startEnabled
                            ? "available from start"
                            : `unlocked${
                                m.unlockedBy.length
                                  ? ` · ${m.unlockedBy.map((u) => u.display ?? u.tech).join(", ")}`
                                  : ""
                              }`}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-warning/90">
                          <Lock className="size-3 shrink-0" /> needs{" "}
                          {m.unlockedBy.length
                            ? m.unlockedBy.map((u) => u.display ?? u.tech).join(", ")
                            : "research"}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
