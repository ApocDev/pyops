import { useMutation, useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { factorioLaunchInfoFn, launchFactorioFn } from "../server/bridge/fns";
import { toast } from "../lib/toast-store";
import { Button } from "#/components/ui/button.tsx";

/** "Launch Factorio" with the bridge flag pre-wired — the same gesture as the
 * Settings Live-bridge card, surfaced wherever starting the game should be one
 * click away (the home page). Owns its query/mutation so it drops in anywhere;
 * launch feedback lands as a toast. */
export function LaunchFactorioButton({
  size = "default",
  variant = "outline",
}: {
  size?: "default" | "sm";
  variant?: "default" | "outline";
}) {
  const info = useQuery({
    queryKey: ["factorioLaunchInfo"],
    queryFn: () => factorioLaunchInfoFn(),
    refetchInterval: 5000,
  });
  const running = info.data?.running === true;
  const launch = useMutation({
    mutationFn: () => launchFactorioFn(),
    onSuccess: (r) => {
      if (!r.ok) {
        toast({ message: r.error ?? "launch failed", tone: "destructive" });
        return;
      }
      toast({
        message:
          r.via === "steam"
            ? `Launching Factorio via Steam (bridge port ${r.port})…`
            : r.isSteam
              ? `Steam didn't respond — launched directly on port ${r.port} (no Steam Cloud saves / achievements)`
              : `Launching Factorio (bridge port ${r.port})…`,
        tone: "success",
      });
    },
    onError: (e) =>
      toast({ message: e instanceof Error ? e.message : String(e), tone: "destructive" }),
  });

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => launch.mutate()}
      disabled={running || launch.isPending}
      title={
        running
          ? "Factorio is already running"
          : "Launch Factorio with the bridge flag already set — the live link connects on its own"
      }
    >
      <Play className="size-3.5" />
      {launch.isPending ? "Launching…" : running ? "Factorio running" : "Launch Factorio"}
    </Button>
  );
}
