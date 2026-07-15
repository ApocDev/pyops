/**
 * One-click follow-ups on assistant draft cards (#13). The agent already tells
 * the user in prose to "draft super-alloy @ 3.3/s next" and to route each
 * byproduct — these chips turn that advice into buttons that send the matching
 * request as the next chat message, tightening the planning loop. The data is
 * already on the draft: subBlocksNeeded (good + solved rate) and byproducts.
 */
import { useQuery } from "@tanstack/react-query";
import { Grid2x2, Recycle } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Icon } from "#/lib/icons";
import { formatRate } from "#/lib/format";
import { classifyRefFn } from "#/server/factorio";

export type FollowUp = {
  kind: "draft" | "route";
  good: string;
  rate?: number | null;
};

/** The chat prompt a chip sends — exported for tests (and so the wording lives
 * in one place). Internal names go through verbatim; the agent resolves them. */
export function followUpPrompt(f: FollowUp): string {
  if (f.kind === "draft") {
    return f.rate != null
      ? `Draft a block: ${f.good} @ ${formatRate(f.rate)}.`
      : `Draft a block for ${f.good}, sized to my factory's demand.`;
  }
  return `Route the byproduct ${f.good}${
    f.rate != null ? ` (${formatRate(f.rate)})` : ""
  }: find where it should go (a consuming recipe, an importing block, or a void) and recommend the routing.`;
}

/** One chip: icon + localized name + rate, labelled by action. A private helper
 * of FollowUpChips. */
function Chip({
  f,
  disabled,
  onFollowUp,
}: {
  f: FollowUp;
  disabled?: boolean;
  onFollowUp: (prompt: string) => void;
}) {
  // same cache key as the transcript's rich refs, so displays resolve once
  const { data } = useQuery({
    queryKey: ["ref", f.good, undefined],
    queryFn: () => classifyRefFn({ data: { name: f.good } }),
    staleTime: 5 * 60_000,
  });
  const display = data?.display ?? f.good;
  const kind = data && data.kind !== "recipe" ? data.kind : "item";
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => onFollowUp(followUpPrompt(f))}
      title={followUpPrompt(f)}
      className="h-auto gap-1.5 py-1 text-muted-foreground hover:text-foreground"
    >
      {f.kind === "draft" ? (
        <Grid2x2 className="size-3.5 text-primary" />
      ) : (
        <Recycle className="size-3.5 text-surplus" />
      )}
      <span className="text-foreground">
        {f.kind === "draft" ? "Draft" : "Route"} {display}
      </span>
      {f.rate != null && <span className="text-xs">{formatRate(f.rate)}</span>}
      <Icon kind={kind} name={f.good} size="sm" noTitle />
    </Button>
  );
}

/** The chip row a draft/plan card renders under its body: "Draft <good> @ rate"
 * for each suggested sub-block, "Route <good>" for each byproduct. Clicking
 * sends the request into the active chat (disabled while the agent is busy). */
export function FollowUpChips({
  followUps,
  disabled,
  onFollowUp,
}: {
  followUps: FollowUp[];
  disabled?: boolean;
  onFollowUp?: (prompt: string) => void;
}) {
  if (!onFollowUp || followUps.length === 0) return null;
  return (
    <div className="mt-2.5">
      <div className="text-xs tracking-wide text-muted-foreground">Next steps</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {followUps.map((f) => (
          <Chip key={`${f.kind}:${f.good}`} f={f} disabled={disabled} onFollowUp={onFollowUp} />
        ))}
      </div>
    </div>
  );
}
