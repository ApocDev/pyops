import { HelpButton } from "./help-drawer";

/** Docs drawer for the logistics-throughput readout — shared by the header
 * dialog and the Settings card. */
export function LogisticsHelpButton({ className }: { className?: string }) {
  return (
    <HelpButton title="Logistics throughput" className={className}>
      <p>
        With the readout on, each block row shows how many <b className="text-foreground">belts</b>{" "}
        carry that item across the row, and how many{" "}
        <b className="text-foreground">inserters or loaders</b> it takes to move it in or out of one
        building at the planned rate. Ingredients count inserters taking from the belt; products
        count inserters dropping onto it, which is slower for big hands. It's a quick feasibility
        check: when the inserter count gets silly, reach for loaders or direct insertion.
      </p>
      <p>
        Pick the belt and inserter/loader tier to size against. Hover an option to see its effective
        throughput. <b className="text-foreground">Rockets</b> shows launches per minute to move
        each good — floor(1,000,000 / item weight) items per rocket.
      </p>
      <p>
        The block-balance card's <b className="text-foreground">sushi</b> button opens the sushi
        planner: it sizes one mixed loop carrying the block's solid ins and outs — capacity verdict,
        per-item on-belt set-points for a circuit-controlled build, pass frequency, and spoil-dwell
        warnings. Its own ? drawer explains the model.
      </p>
      <p>
        <b className="text-foreground">Robots</b> shows the logistic robots each import and export
        needs, and the block total in the balance card. A robot carries a full load (at most one
        stack) out over the trip distance and flies back empty, and stops to charge at the selected
        roboport. Set the trip distance here for the whole factory; a far-off block can set its own
        in its balance card. Speed and cargo research come from the game over the bridge.
      </p>
      <p>
        <b className="text-foreground">Stacking</b> — belt-stack and inserter-capacity research from
        the planning horizon raise throughput. Cranes count the upgraded tier that research swaps
        in. The belt-stack override pins the belt's placed stack size; leave it blank to follow
        research.
      </p>
    </HelpButton>
  );
}
