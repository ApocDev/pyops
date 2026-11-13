import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Clock } from "lucide-react";
import { researchHorizonSubscription } from "../lib/live-query-options";
import { HorizonHelpButton } from "./horizon-help";
import { HorizonPicker, horizonLabel } from "./horizon-picker";
import { TOPBAR_LABEL } from "./nav-links";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";

/** Header control for the global planning horizon: shows the current horizon and
 * opens a dialog to change it (Now / Future / Up to target). */
export function HorizonMenu() {
  const [open, setOpen] = useState(false);
  const h = useQuery(researchHorizonSubscription);
  const label = h.data ? horizonLabel(h.data) : "…";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-full min-w-16 shrink gap-1.5 px-3 font-normal text-muted-foreground hover:bg-muted/50"
          title="Planning horizon — what the planner is allowed to use (blocks, picker, assistant)"
        >
          <Clock className="size-4" />
          <span className={TOPBAR_LABEL}>Horizon:</span>
          <span className="max-w-40 min-w-0 truncate text-foreground">{label}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="md:max-w-[37rem]">
        <DialogHeader>
          <DialogTitle>Planning horizon</DialogTitle>
          <HorizonHelpButton className="mr-7 ml-auto" />
        </DialogHeader>
        <DialogBody>
          <HorizonPicker />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
