import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Clock } from "lucide-react";
import { researchHorizonFn } from "../server/factorio";
import { HorizonHelpButton } from "./horizon-help";
import { HorizonPicker, horizonLabel } from "./horizon-picker";
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
  const h = useQuery({
    queryKey: ["researchHorizon"],
    queryFn: () => researchHorizonFn(),
    refetchInterval: 4000,
  });
  const label = h.data ? horizonLabel(h.data) : "…";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-full gap-1.5 px-3 font-normal text-muted-foreground hover:bg-muted/50"
          title="Planning horizon — what the planner is allowed to use (blocks, picker, assistant)"
        >
          <Clock className="size-4" /> Horizon: <span className="text-foreground">{label}</span>
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
