import { Link } from "@tanstack/react-router";

import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { rateLabel } from "#/lib/format.ts";

type ValidationData = {
  materialConflicts: {
    good: string;
    display: string;
    direction: "shortage" | "excess";
    amount: number;
    required: number;
    available: number;
    blocks: {
      id: number;
      name: string;
      supplied: number;
      consumed: number;
      configuredProducer: boolean;
      scalableProducer: boolean;
    }[];
  }[];
  blocks: {
    id: number;
    name: string;
    status: string;
    message?: string;
    goals: { good: string; display: string; rate: number }[];
    unmade: { good: string; display: string }[];
  }[];
  discrepancies: {
    good: string;
    display: string;
    expected: number;
    actual: number;
    relative: number;
  }[];
  unstableGoals: {
    blockId: number;
    blockName: string;
    good: string;
    display: string;
    reference: number;
    rate: number;
  }[];
};

/** Actionable evidence from Scenario's final full-block validation pass. */
export function ScenarioValidationCard({
  status,
  validation,
}: {
  status: string;
  validation: ValidationData | null;
}) {
  const validationFailed = status === "ValidationFailed";
  const hasDetails =
    validation != null &&
    (validation.materialConflicts.length > 0 ||
      validation.blocks.length > 0 ||
      validation.discrepancies.length > 0 ||
      validation.unstableGoals.length > 0);

  return (
    <Card className="mb-4 border-warning/40" data-testid="scenario-validation">
      <CardHeader>
        <CardTitle className="normal-case text-warning">
          {validationFailed ? "Scenario validation failed" : `Scenario solve failed: ${status}`}
        </CardTitle>
      </CardHeader>
      <Callout tone="warning" variant="strip">
        {validationFailed
          ? "The factory model found rates, but the full block solves did not confirm them. Nothing was saved."
          : "The factory material model could not find a complete set of rates. Nothing was saved."}
      </Callout>

      {hasDetails ? (
        <CardContent className="space-y-4">
          {validation.materialConflicts.length > 0 && (
            <section className="space-y-3" aria-label="Factory material conflicts">
              {validation.materialConflicts.slice(0, 5).map((conflict) => (
                <div key={conflict.good} className="space-y-2 border-t pt-2 first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-warning">
                      {conflict.display} {conflict.direction}:{" "}
                      {rateLabel(conflict.good, conflict.amount, { perSec: true })}
                    </span>
                    <span className="text-muted-foreground">
                      {rateLabel(conflict.good, conflict.required, { perSec: true })} required ·{" "}
                      {rateLabel(conflict.good, conflict.available, { perSec: true })} available
                    </span>
                  </div>
                  <div className="grid gap-x-6 gap-y-1 lg:grid-cols-2">
                    {conflict.blocks.map((block) => (
                      <div
                        key={block.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-t py-1"
                      >
                        <Link
                          to="/block/$id"
                          params={{ id: String(block.id) }}
                          className="text-primary underline"
                        >
                          {block.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {block.consumed > 0 &&
                            `uses ${rateLabel(conflict.good, block.consumed, { perSec: true })}`}
                          {block.consumed > 0 && block.supplied > 0 && " · "}
                          {block.supplied > 0 &&
                            `supplies ${rateLabel(conflict.good, block.supplied, { perSec: true })}`}
                        </span>
                        {block.configuredProducer && !block.scalableProducer && (
                          <span className="col-span-full text-warning">
                            The configured {conflict.display} goal has no additional scalable
                            output.
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {validation.blocks.map((block) => (
            <section key={block.id} className="space-y-2" aria-label={`${block.name} validation`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  to="/block/$id"
                  params={{ id: String(block.id) }}
                  className="font-semibold text-primary underline"
                >
                  {block.name}
                </Link>
                <span className="text-warning">block solve: {block.status}</span>
              </div>
              {block.message && (
                <p className="text-muted-foreground">Solver detail: {block.message}</p>
              )}
              <div>
                <div className="mb-1 font-semibold">Proposed goals on validation pass</div>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-4">
                  {block.goals.map((goal) => (
                    <div key={goal.good} className="flex justify-between gap-3 border-t py-1">
                      <span className="truncate">{goal.display}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {rateLabel(goal.good, goal.rate, { perSec: true })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {block.unmade.length > 0 && (
                <p className="text-warning">
                  Missing in-block producers: {block.unmade.map((good) => good.display).join(", ")}
                </p>
              )}
            </section>
          ))}

          {validation.discrepancies.length > 0 && (
            <section className="space-y-1" aria-label="Material mismatches">
              <div className="font-semibold">Material flows that did not match</div>
              {validation.discrepancies.slice(0, 5).map((flow) => (
                <div
                  key={flow.good}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t py-1"
                >
                  <span className="truncate">{flow.display}</span>
                  <span className="text-muted-foreground">
                    expected {rateLabel(flow.good, flow.expected, { perSec: true })}, got{" "}
                    {rateLabel(flow.good, flow.actual, { perSec: true })} (
                    {Math.round(flow.relative * 1000) / 10}% mismatch)
                  </span>
                </div>
              ))}
            </section>
          )}

          {validation.unstableGoals.length > 0 && (
            <section className="space-y-1" aria-label="Unstable goals">
              <div className="font-semibold">Goals that did not settle between passes</div>
              {validation.unstableGoals.slice(0, 5).map((goal) => (
                <div
                  key={`${goal.blockId}-${goal.good}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t py-1"
                >
                  <Link
                    to="/block/$id"
                    params={{ id: String(goal.blockId) }}
                    className="truncate text-primary underline"
                  >
                    {goal.display} — {goal.blockName}
                  </Link>
                  <span className="text-muted-foreground">
                    {rateLabel(goal.good, goal.reference, { perSec: true })} →{" "}
                    {rateLabel(goal.good, goal.rate, { perSec: true })}
                  </span>
                </div>
              ))}
            </section>
          )}
        </CardContent>
      ) : (
        <CardContent className="text-muted-foreground">
          No narrower cause was reported. Check the configured goals, made goods, and recipe pins in
          the affected chain; the structured trace under Settings → Advanced contains the complete
          solver model.
        </CardContent>
      )}
    </Card>
  );
}
