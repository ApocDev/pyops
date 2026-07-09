import { HelpButton } from "./help-drawer";

/** Docs drawer for the logistics-throughput readout — shared by the header
 * dialog and the Settings card. */
export function LogisticsHelpButton({ className }: { className?: string }) {
  return (
    <HelpButton title="Logistics throughput" className={className}>
      <p>
        With the readout on, each block row shows how many <b className="text-foreground">belts</b>{" "}
        carry that item across the row, and how many{" "}
        <b className="text-foreground">inserters or loaders</b> it takes to feed one building at the
        planned rate. It's a quick feasibility check: when the inserter count gets silly, reach for
        loaders or direct insertion.
      </p>
      <p>
        Pick the belt and inserter/loader tier to size against. Hover an option to see its effective
        throughput. <b className="text-foreground">Rockets</b> shows launches per minute to move
        each good — floor(1,000,000 / item weight) items per rocket.
      </p>
      <p>
        <b className="text-foreground">Stacking</b> — belt-stack and inserter-capacity research from
        the planning horizon raise throughput. The belt-stack override pins the placed stack size
        (it applies to belts only); leave it blank to follow research.
      </p>
    </HelpButton>
  );
}
