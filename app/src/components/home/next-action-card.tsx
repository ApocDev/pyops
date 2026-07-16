import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Factory,
  Gauge,
  Hammer,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { HomeAction } from "../../lib/home-actions.ts";
import { formatRate } from "../../lib/format.ts";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";

export function NextActionCard({
  action,
  canDismiss,
  dismissedCount,
  pending,
  onDismiss,
  onRestore,
}: {
  action: HomeAction;
  canDismiss: boolean;
  dismissedCount: number;
  pending: boolean;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  let icon: ReactNode;
  let title: ReactNode;
  let description: ReactNode;
  let button: ReactNode;

  if (action.kind === "resync") {
    icon = <RefreshCw className="size-5 text-warning" />;
    title = "Re-sync game data";
    description =
      "The active mods or PyOps data reader changed. Refresh the reference data before trusting other recommendations.";
    button = (
      <Button asChild>
        <Link to="/settings" search={{ tab: "data" }}>
          Review data <ArrowRight />
        </Link>
      </Button>
    );
  } else if (action.kind === "drain") {
    icon = <Activity className="size-5 text-destructive" />;
    title = `${action.drain.display} is draining`;
    description = (
      <>
        The connected factory is making {formatRate(action.drain.produced)} and using{" "}
        {formatRate(action.drain.consumed)}. In-game flow takes priority over the plan.
      </>
    );
    button = (
      <Button asChild>
        <Link to="/factory">
          Open Factory <ArrowRight />
        </Link>
      </Button>
    );
  } else if (action.kind === "unbuilt") {
    icon = <Hammer className="size-5 text-warning" />;
    title = `Start ${action.build.block}`;
    description = `None of this block’s ${action.build.requiredSteps} required ${action.build.requiredSteps === 1 ? "step is" : "steps are"} running in-game yet. Start with one machine for any required recipe.`;
    button = (
      <Button asChild>
        <Link to="/block/$id" params={{ id: String(action.build.blockId) }}>
          Open block <ArrowRight />
        </Link>
      </Button>
    );
  } else if (action.kind === "partial") {
    icon = <Hammer className="size-5 text-warning" />;
    title = `Finish ${action.build.block}`;
    description = `${action.build.coveredSteps} of ${action.build.requiredSteps} required steps are running somewhere. Add one machine for each remaining recipe before worrying about scale.`;
    button = (
      <Button asChild>
        <Link to="/block/$id" params={{ id: String(action.build.blockId) }}>
          Open block <ArrowRight />
        </Link>
      </Button>
    );
  } else if (action.kind === "plan") {
    icon = <Factory className="size-5 text-destructive" />;
    title = `Plan ${action.deficit.display}`;
    description = `The plan is short ${formatRate(Math.abs(action.deficit.net))}, and a producer is available under the current planning horizon.`;
    button = (
      <Button asChild>
        <Link to="/factory">
          Open Factory <ArrowRight />
        </Link>
      </Button>
    );
  } else if (action.kind === "scale") {
    icon = <Gauge className="size-5 text-info" />;
    title = `Scale ${action.build.block} when ready`;
    description = `Every required recipe is running. The block is operational, with ${action.build.missingMachines} of ${action.build.requiredMachines} planned machines still optional to place.`;
    button = (
      <Button asChild variant="outline">
        <Link to="/block/$id" params={{ id: String(action.build.blockId) }}>
          Open block <ArrowRight />
        </Link>
      </Button>
    );
  } else if (action.kind === "unhealthy") {
    icon = <AlertTriangle className="size-5 text-warning" />;
    title = `Review ${action.block.name}`;
    description =
      "No more urgent factory work is visible. This block is unhealthy or unfinished and may simply be an intentional draft.";
    button = (
      <Button asChild variant="outline">
        <Link to="/block/$id" params={{ id: String(action.block.id) }}>
          Open block <ArrowRight />
        </Link>
      </Button>
    );
  } else {
    icon = <Check className="size-5 text-success" />;
    title = "Everything actionable is caught up";
    description =
      "No live drain, missing recipe coverage, or currently-plannable factory deficit needs attention.";
    button = (
      <Button asChild variant="outline">
        <Link to="/factory/scenario">
          Try a scenario <ArrowRight />
        </Link>
      </Button>
    );
  }

  return (
    <Card data-home-action={action.kind} className="border-primary/50 bg-primary/5">
      <CardHeader className="justify-between">
        <CardTitle className="text-primary">Next action</CardTitle>
        {dismissedCount > 0 && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={onRestore}>
            <RotateCcw /> Restore {dismissedCount} dismissed
          </Button>
        )}
      </CardHeader>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-lg font-semibold">
            {icon}
            {title}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {canDismiss && (
            <Button variant="ghost" disabled={pending} onClick={onDismiss}>
              <X /> Dismiss for now
            </Button>
          )}
          {button}
        </div>
      </div>
    </Card>
  );
}
