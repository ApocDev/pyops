import { useEffect, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { Check, Clock3, History, Infinity as InfinityIcon, Sigma, TimerReset } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger } from "#/components/ui/select.tsx";
import type { CampaignConfidence, RateUnit } from "../../db/schema.ts";
import { campaignConfidenceLabel } from "../../lib/campaign.ts";
import type { BlockDocStore } from "./doc-store.ts";
import { TIME_UNIT_FACTOR, TimeUnitControl } from "./time-unit-control.tsx";

const naturalDurationUnit = (seconds: number): RateUnit =>
  seconds >= 3600 && seconds % 3600 === 0 ? "h" : seconds >= 60 && seconds % 60 === 0 ? "min" : "s";
const durationValue = (seconds: number, unit: RateUnit) =>
  String(Number((seconds / TIME_UNIT_FACTOR[unit]).toPrecision(10)));

/** Block-level controls for finite production intent. The campaign still solves
 * as ordinary throughput; these controls own the finite quantity time horizon
 * and the optional probability reserve. */
export function TemporaryCampaignControls({
  doc,
  blockEnabled,
  onComplete,
  onReactivate,
}: {
  doc: BlockDocStore;
  blockEnabled: boolean;
  onComplete: () => void;
  onReactivate: () => void;
}) {
  const campaign = useStore(doc.store, (state) => state.campaign);
  const [unit, setUnit] = useState<RateUnit>("h");
  const [duration, setDuration] = useState("");
  useEffect(() => {
    if (!campaign) {
      setDuration("");
      return;
    }
    const nextUnit = naturalDurationUnit(campaign.duration);
    setUnit(nextUnit);
    setDuration(durationValue(campaign.duration, nextUnit));
  }, [campaign?.duration]);

  const modeToggle = (
    <Tooltip
      content={
        campaign
          ? "Temporary campaign — click to return to ongoing throughput"
          : "Ongoing throughput — click to make this a temporary campaign"
      }
    >
      <Button
        size="icon-sm"
        variant="toggle"
        aria-label={campaign ? "Make this block ongoing" : "Make this block temporary"}
        aria-pressed={!!campaign}
        onClick={() => {
          if (campaign) {
            doc.makeOngoing();
            doc.note("Make block ongoing");
          } else {
            doc.makeTemporary();
            doc.note("Make block temporary");
          }
        }}
      >
        {campaign ? <TimerReset /> : <InfinityIcon />}
      </Button>
    </Tooltip>
  );

  if (!campaign) return modeToggle;

  const commitDuration = () => {
    const value = Number(duration);
    if (Number.isFinite(value) && value > 0) {
      doc.setCampaignDuration(value * TIME_UNIT_FACTOR[unit]);
      doc.note("Set campaign duration");
    } else setDuration(durationValue(campaign.duration, unit));
  };
  const completed = !!campaign.completedAt;
  return (
    <div className="flex flex-nowrap items-center justify-end gap-1">
      {modeToggle}
      <Tooltip content="Campaign duration">
        <span className="flex h-7 items-center border border-input bg-background pl-1.5 text-muted-foreground dark:bg-input/30">
          <Clock3 className="size-3.5 shrink-0" />
          <Input
            aria-label="Campaign duration"
            inputMode="decimal"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            onBlur={commitDuration}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-6 w-11 border-0 bg-transparent px-1 text-right shadow-none focus-visible:ring-0"
          />
          <TimeUnitControl
            unit={unit}
            prefix=""
            title="Campaign duration unit — click to cycle seconds / minutes / hours"
            className="pr-1.5"
            onChange={(nextUnit) => {
              setUnit(nextUnit);
              setDuration(durationValue(campaign.duration, nextUnit));
            }}
          />
        </span>
      </Tooltip>
      <Select
        value={campaign.confidence}
        onValueChange={(value) => {
          doc.setCampaignConfidence(value as CampaignConfidence);
          doc.note("Set campaign confidence");
        }}
      >
        <Tooltip content="Probability reserve for variable recipe results">
          <SelectTrigger size="sm" aria-label="Campaign confidence" className="min-w-0 px-1.5">
            {campaign.confidence === "expected" ? (
              <Sigma className="size-3.5" aria-hidden="true" />
            ) : (
              <span className="tabular-nums">{campaign.confidence}%</span>
            )}
          </SelectTrigger>
        </Tooltip>
        <SelectContent position="popper" align="end">
          {(["expected", "90", "95"] as const).map((confidence) => (
            <SelectItem key={confidence} value={confidence}>
              {campaignConfidenceLabel(confidence)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {completed || !blockEnabled ? (
        <Tooltip content="Reactivate this campaign and include it in factory planning">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Reactivate temporary campaign"
            onClick={onReactivate}
          >
            <History />
          </Button>
        </Tooltip>
      ) : (
        <Tooltip content="Mark complete and remove this campaign from factory planning">
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label="Complete temporary campaign"
            onClick={onComplete}
          >
            <Check />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
