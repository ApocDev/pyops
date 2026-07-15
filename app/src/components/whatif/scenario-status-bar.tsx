import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";

type ScenarioProgress = {
  message: string;
  elapsedMs: number;
  pass?: number;
  maxPasses?: number;
};

function elapsedLabel(ms: number) {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

export function ScenarioStatusBar({
  state,
  dirty,
  calculating,
  progress,
  calculatedAt,
  durationMs,
  error,
  onRecalculate,
}: {
  state: "current" | "stale" | "empty" | "loading";
  dirty: boolean;
  calculating: boolean;
  progress: ScenarioProgress | null | undefined;
  calculatedAt: string | null | undefined;
  durationMs: number | null | undefined;
  error: boolean;
  onRecalculate: () => void;
}) {
  if (calculating) {
    const message = progress?.message ?? "Preparing Scenario calculation";
    return (
      <Callout
        tone="info"
        icon={LoaderCircle}
        title={message}
        className="mb-4 [&>svg]:animate-spin"
        data-testid="scenario-status"
        data-state="calculating"
      >
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          <span>{progress ? `Running for ${elapsedLabel(progress.elapsedMs)}` : "Starting…"}</span>
          {progress?.pass != null && progress.maxPasses != null && (
            <span>
              Pass {progress.pass} of {progress.maxPasses}
            </span>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden bg-muted" aria-hidden>
          <div className="h-full w-2/3 animate-pulse bg-info" />
        </div>
      </Callout>
    );
  }

  if (state === "loading") {
    return (
      <Callout
        tone="info"
        icon={LoaderCircle}
        title="Checking the saved Scenario result"
        className="mb-4 [&>svg]:animate-spin"
        data-testid="scenario-status"
        data-state="loading"
      >
        Comparing the cached result with the current factory inputs.
      </Callout>
    );
  }

  if (error) {
    return (
      <Callout
        tone="destructive"
        title="Scenario could not be recalculated"
        action={
          <Button variant="outline" size="sm" onClick={onRecalculate}>
            <RefreshCw /> Try again
          </Button>
        }
        className="mb-4"
        data-testid="scenario-status"
        data-state="error"
      >
        The previous result remains visible. Try again or inspect the solver diagnostic.
      </Callout>
    );
  }

  if (state === "current" && !dirty) {
    const when = calculatedAt ? new Date(calculatedAt).toLocaleTimeString() : null;
    return (
      <Callout
        tone="success"
        title="Scenario is up to date"
        action={
          <Button variant="outline" size="sm" onClick={onRecalculate}>
            <RefreshCw /> Recalculate
          </Button>
        }
        className="mb-4"
        data-testid="scenario-status"
        data-state="current"
        data-calculated-at={calculatedAt ?? undefined}
      >
        {when ? `Calculated at ${when}` : "Using the current factory inputs"}
        {durationMs != null ? ` · took ${elapsedLabel(durationMs)}` : ""}
      </Callout>
    );
  }

  return (
    <Callout
      tone="warning"
      title={
        state === "empty" ? "Scenario has not been calculated yet" : "Scenario needs recalculation"
      }
      action={
        <Button size="sm" onClick={onRecalculate}>
          <RefreshCw /> Recalculate
        </Button>
      }
      className="mb-4"
      data-testid="scenario-status"
      data-state={state === "empty" ? "empty" : "stale"}
      data-calculated-at={calculatedAt ?? undefined}
    >
      {state === "empty"
        ? "Calculate once to build the factory-wide preview."
        : dirty
          ? "Targets or factory inputs changed. The previous result stays visible until you recalculate."
          : "The factory changed since this result was calculated. The previous result is still shown below."}
    </Callout>
  );
}
