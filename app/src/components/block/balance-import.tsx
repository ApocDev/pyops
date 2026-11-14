import { memo } from "react";
import { CircleAlert, Lock } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { countRender } from "../../lib/render-count.ts";
import { ItemChip, type Link as ItemLink } from "./item-chip.tsx";
import { LogiTag } from "./logi-tag.tsx";
import type { LogiView, SolveResult } from "./solve-view.ts";

type Flow = SolveResult["qualifiedDisplayImports"][number];

/** One import of the Block balance card: the chip, the sizing-lock controls
 * when this input sizes the block, and its logistics readout.
 *
 * Memoized (#154): the card passes primitives and stable callbacks, so an edit
 * re-renders only the imports it changed. The flow's fields come in one by
 * one because the solve sorts flows by rate: a rate change shifts the list,
 * and structural sharing matches array items by index, so a shifted flow
 * arrives as a new object even when its numbers didn't move. */
export const BalanceImport = memo(function BalanceImport({
  name,
  kind,
  rate,
  temp,
  display,
  total,
  craftable,
  fuel,
  unsourced,
  locked,
  lockedRate,
  onLockedRateChange,
  onUnlock,
  logi,
  onMakeFor,
  onCtxMenu,
}: {
  name: Flow["name"];
  kind: Flow["kind"];
  rate: Flow["rate"];
  temp: Flow["temp"];
  display: string | undefined;
  /** campaign total (rate × duration), when the block is a temporary campaign */
  total: number | undefined;
  /** a recipe could make it in-block */
  craftable: boolean;
  /** consumed as fuel (folded into the balance) */
  fuel: boolean;
  /** no other enabled block exports it */
  unsourced: boolean;
  /** this input sizes the block ("Size block by this input") */
  locked: boolean;
  lockedRate: number;
  onLockedRateChange: (rate: number) => void;
  onUnlock: () => void;
  logi: LogiView;
  onMakeFor: (name: string) => void;
  onCtxMenu: (
    e: { clientX: number; clientY: number },
    d: { name: string; kind: string; link: ItemLink },
  ) => void;
}) {
  countRender(`import:${name}`);
  return (
    <span className="group flex w-max shrink-0 flex-col items-start gap-1.5">
      <span className="inline-flex items-center gap-1.5">
        <ItemChip
          name={name}
          kind={kind}
          display={display}
          rate={rate}
          total={total}
          temp={temp}
          link="import"
          craftable={craftable}
          fuel={fuel}
          indicatorLabel={unsourced ? "Not produced by another enabled block" : undefined}
          indicator={
            unsourced ? (
              <Tooltip content="No other enabled block currently exports this. It may still be an intentional raw or external input.">
                <span data-unsourced-import={name} className="flex shrink-0 text-warning/80">
                  <CircleAlert className="size-3.5" />
                </span>
              </Tooltip>
            ) : undefined
          }
          onClick={() => onMakeFor(name)}
          onContext={(e) => onCtxMenu(e, { name, kind, link: "import" })}
        />
        {/* Locked-as-block-driver state (set via right-click → "Size block by this
            input"): edit its rate inline + an unlock control. The toggle itself
            lives in the context menu, so non-locked rows stay uncluttered. */}
        {locked && (
          <>
            <Tooltip content="Locked rate — the block is sized to consume this much of this input">
              <Input
                type="number"
                value={lockedRate}
                step="0.01"
                min="0"
                autoFocus
                onChange={(e) => onLockedRateChange(Number(e.target.value) || 0)}
                className="h-7 w-16 border-info/60 px-1"
              />
            </Tooltip>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onUnlock}
              title="Unlock — the Goal rate is editable again"
              className="text-info"
            >
              <Lock className="size-3.5" />
            </Button>
          </>
        )}
      </span>
      {logi.resolved && kind === "item" && (
        <LogiTag
          resolved={logi.resolved}
          rate={rate}
          machineCount={0}
          direction="input"
          showBelts={logi.showBelts}
          showInserters={logi.showInserters}
          launch={logi.launchInfo(name, rate)}
          robots={logi.robotsFor({ name, kind, rate })}
        />
      )}
    </span>
  );
});
