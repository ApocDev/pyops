import { useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { setFavoriteFuelFn } from "../../server/factorio";
import { Badge } from "#/components/ui/badge.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Icon } from "../../lib/icons";
import { fmtJ } from "./format.ts";
import { rowBtn } from "./styles.ts";

/** Fuel picker — choose what a burner burns (energy value shown to compare),
 * with the favorite star (#18). Favorites are app-level prefs; toggling one
 * refetches the solve so its ☆ updates without touching the block's picks. */
export function FuelPickerDialog({
  recipeDisplay,
  fuels,
  current,
  onPick,
  onClose,
}: {
  recipeDisplay: string;
  fuels: {
    name: string;
    display: string | null;
    kind: string;
    fuelValueJ: number | null;
    favorite: boolean;
  }[];
  /** the fuel the current solve burns for this recipe */
  current: string | null;
  onPick: (fuel: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toggleFavorite = (fuel: string, isFav: boolean) => {
    void setFavoriteFuelFn({ data: { fuel, clear: isFav } }).then(() => {
      void qc.invalidateQueries({ queryKey: ["solve"] });
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
          {fuels.map((f) => {
            const cur = current === f.name;
            return (
              <button
                key={f.name}
                className={`${rowBtn} w-full ${cur ? "bg-accent" : ""}`}
                onClick={() => onPick(f.name)}
              >
                <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="md" noTitle />
                <span className="truncate text-foreground">{f.display ?? f.name}</span>
                {f.fuelValueJ != null && (
                  <Badge variant="secondary">
                    {fmtJ(f.fuelValueJ)}
                    {f.kind === "fluid" ? "/unit" : ""}
                  </Badge>
                )}
                {cur && <span className="text-sm text-primary">current</span>}
                {/* solid fuels favorite per fuel category; fluids have no
                    category, so a fluid star sets the single preferred fluid fuel */}
                <span
                  role="button"
                  tabIndex={-1}
                  title={
                    f.kind === "fluid"
                      ? f.favorite
                        ? "Preferred fluid fuel — new fluid burners use it. Click to clear."
                        : "Set as the preferred fluid fuel (new fluid burners will use it)"
                      : f.favorite
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
          {!fuels.length && (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              no fuels for this machine's categories
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
