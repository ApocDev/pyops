import { memo } from "react";
import { Timer } from "lucide-react";
import { fmtSpoilTime } from "../../lib/icons";
import { countRender } from "../../lib/render-count.ts";
import { ItemChip, type Link as ItemLink } from "./item-chip.tsx";
import { LogiTag } from "./logi-tag.tsx";
import { OutputPriorityOverride } from "./output-priority-override.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";

type Flow = SolveResult["qualifiedDisplayExports"][number];

/** One export of the Block balance card: the chip, its supply-priority
 * override, the incidental-spoil estimate button for a spoilable surplus, and
 * its logistics readout.
 *
 * Memoized (#154): the card passes primitives and stable callbacks, so an edit
 * re-renders only the exports it changed. The flow's fields come in one by
 * one because the solve sorts flows by rate: a rate change shifts the list,
 * and structural sharing matches array items by index, so a shifted flow
 * arrives as a new object even when its numbers didn't move. */
export const BalanceExport = memo(function BalanceExport({
  doc,
  name,
  kind,
  rate,
  temp,
  display,
  total,
  fuel,
  incidental,
  inheritedPriority,
  priority,
  spoilTicks,
  logi,
  onUseFor,
  onCtxMenu,
  onOpenSpoilDialog,
}: {
  doc: BlockDocStore;
  name: Flow["name"];
  kind: Flow["kind"];
  rate: Flow["rate"];
  temp: Flow["temp"];
  display: string | undefined;
  /** campaign total (rate × duration), when the block is a temporary campaign */
  total: number | undefined;
  /** consumed as fuel (folded into the balance) */
  fuel: boolean;
  /** part of the surplus is estimated incidental spoilage (#20) */
  incidental: boolean;
  /** the block's supply priority */
  inheritedPriority: number;
  /** this output's own override, if any */
  priority: number | undefined;
  /** the item's spoil time in ticks, when it spoils */
  spoilTicks: number | undefined;
  logi: LogiView;
  onUseFor: (name: string) => void;
  onCtxMenu: (
    e: { clientX: number; clientY: number },
    d: { name: string; kind: string; link: ItemLink },
  ) => void;
  onOpenSpoilDialog: (name: string) => void;
}) {
  countRender(`export:${name}`);
  const label = display ?? name;
  return (
    <span className="flex w-max shrink-0 flex-col items-start gap-1.5">
      <ItemChip
        name={name}
        kind={kind}
        display={display}
        rate={rate}
        total={total}
        temp={temp}
        link="export"
        fuel={fuel}
        incidental={incidental}
        onClick={() => onUseFor(name)}
        onContext={(e) => onCtxMenu(e, { name, kind, link: "export" })}
      />
      <OutputPriorityOverride
        inherited={inheritedPriority}
        value={priority}
        onChange={(next) => {
          doc.setOutputSupplyPriority(name, next);
          doc.note(
            next == null
              ? `Inherit block supply priority for "${label}"`
              : `Override supply priority for "${label}"`,
          );
        }}
      />
      {/* incidental-spoil risk (#20): a SURPLUS spoilable is the one that
          actually sits around long enough to rot — stacked under the chip so
          it doesn't widen the export grid */}
      {spoilTicks != null && (
        <button
          aria-label={`Estimate incidental spoilage for ${label}`}
          onClick={() => onOpenSpoilDialog(name)}
          className="flex items-center gap-1 bg-warning/15 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
        >
          <Timer className="size-3.5" /> {fmtSpoilTime(spoilTicks)}
        </button>
      )}
      {logi.resolved && kind === "item" && (
        <LogiTag
          resolved={logi.resolved}
          rate={rate}
          machineCount={0}
          direction="output"
          showBelts={logi.showBelts}
          showInserters={logi.showInserters}
          launch={logi.launchInfo(name, rate)}
          robots={logi.robotsFor({ name, kind, rate })}
        />
      )}
    </span>
  );
});
