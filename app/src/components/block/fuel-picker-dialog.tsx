import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { fuelPickerOptionsFn, setFavoriteFuelFn } from "../../server/factorio";
import { Badge } from "#/components/ui/badge.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Icon } from "../../lib/icons";
import { fmtJ } from "./format.ts";
import { rowBtn } from "./styles.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** Fuel picker — choose what a SOLID burner burns (energy value shown to
 * compare), with the favorite star (#18). Favorites are app-level prefs;
 * toggling one refetches the picker so its ☆ updates without touching the block's
 * picks or solve. Fluid burners never open this: unfiltered ones draw from the shared
 * fluid-fuel pool and filtered ones are pinned to one fluid (#25). */
export function FuelPickerDialog({
  recipe,
  recipeDisplay,
  machine,
  current,
  onPick,
  onClose,
}: {
  recipe: string;
  recipeDisplay: string;
  machine: string;
  /** the fuel the current solve burns for this recipe */
  current: string | null;
  onPick: (fuel: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fuels = useQuery({
    queryKey: ["fuelOptions", recipe, machine],
    queryFn: () => fuelPickerOptionsFn({ data: { recipe, machine } }),
    staleTime: 60_000,
  });
  const toggleFavorite = (fuel: string, isFav: boolean) => {
    void setFavoriteFuelFn({ data: { fuel, clear: isFav } }).then(() => {
      void qc.invalidateQueries({ queryKey: ["fuelOptions"] });
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle className="truncate">Fuel for {recipeDisplay}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {fuels.isLoading && (
            <div className="space-y-1.5 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-3/4" />
            </div>
          )}
          {fuels.data?.map((f) => {
            const cur = current === f.name;
            return (
              <button
                key={f.name}
                className={`${rowBtn} w-full ${cur ? "bg-accent" : ""}`}
                onClick={() => onPick(f.name)}
              >
                <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="md" noTitle />
                <span className="truncate text-foreground">{f.display ?? f.name}</span>
                {f.fuelValueJ != null && <Badge variant="secondary">{fmtJ(f.fuelValueJ)}</Badge>}
                {cur && <span className="text-sm text-primary">Current</span>}
                {/* favorite per fuel category */}
                <span
                  role="button"
                  tabIndex={-1}
                  title={
                    f.favorite
                      ? "Favorite fuel for this category — new burners here use it. Click to clear."
                      : "Set as the favorite fuel for this category (new burners here will use it)"
                  }
                  className={`ml-auto cursor-pointer text-sm ${f.favorite ? "text-warning" : "text-muted-foreground hover:text-warning"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(f.name, f.favorite);
                  }}
                >
                  <Star className="size-4" fill={f.favorite ? "currentColor" : "none"} />
                </span>
              </button>
            );
          })}
          {fuels.data?.length === 0 && (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              No fuels for this machine's categories
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
