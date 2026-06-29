import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Clock, X } from "lucide-react";
import { researchHorizonFn } from "../server/factorio";
import { HorizonPicker, horizonLabel } from "./horizon-picker";

const item =
  "flex items-center gap-1.5 px-3 h-full text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50";

/** Header control for the global planning horizon: shows the current horizon and
 * opens a dialog to change it (Now / Future / Up to target). */
export function HorizonMenu() {
  const [open, setOpen] = useState(false);
  const h = useQuery({
    queryKey: ["researchHorizon"],
    queryFn: () => researchHorizonFn(),
    refetchInterval: 4000,
  });
  const label = h.data ? horizonLabel(h.data) : "…";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={item}
        title="Planning horizon — what the planner is allowed to use (blocks, picker, assistant)"
      >
        <Clock className="size-4" /> Horizon: <span className="text-foreground">{label}</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-10 font-mono"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[34rem] rounded-lg border border-border bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Planning horizon</h2>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <HorizonPicker />
          </div>
        </div>
      )}
    </>
  );
}
