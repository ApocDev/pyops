import { useStore } from "@tanstack/react-store";
import { AlertTriangle, Cloud, Flame, Lock, Plus, Timer, X, Zap } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { fmtSpoilTime, Icon, useSpoilables } from "../../lib/icons";
import { fmtTemp } from "../../lib/format";
import { ItemChip, dispTag, type Link as ItemLink } from "./item-chip.tsx";
import { LogiTag } from "./logi-tag.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { fmtW, num } from "./format.ts";

/** The Block balance card: solve status, forced-disposition and planned-spoil
 * strips, the infeasible/unmade/unused/temperature warnings, the power line,
 * and the imports/exports chip lists with the sizing-lock controls. */
export function BalanceCard({
  doc,
  res,
  statusColor,
  kindOf,
  producible,
  fuelSet,
  freed,
  lockedInput,
  lockedRate,
  onLockedRateChange,
  onUnlock,
  logi,
  onMakeFor,
  onUseFor,
  onCtxMenu,
  onOpenSpoilDialog,
}: {
  doc: BlockDocStore;
  res: SolveResult | undefined;
  statusColor: string;
  kindOf: (name: string) => "item" | "fluid";
  producible: ReadonlySet<string>;
  /** items consumed as fuel (folded into the balance) */
  fuelSet: ReadonlySet<string>;
  /** items the relaxed solve auto-freed (recycle loop won't self-close) */
  freed: ReadonlySet<string>;
  lockedInput: string | null;
  lockedRate: number;
  onLockedRateChange: (rate: number) => void;
  onUnlock: () => void;
  logi: LogiView;
  onMakeFor: (name: string) => void;
  onUseFor: (name: string) => void;
  onCtxMenu: (
    e: { clientX: number; clientY: number },
    d: { name: string; kind: string; link: ItemLink },
  ) => void;
  onOpenSpoilDialog: (name: string) => void;
}) {
  const disp = useStore(doc.store, (s) => s.dispositions);
  const spoilRates = useStore(doc.store, (s) => s.spoilRates);
  const spoilables = useSpoilables();
  const hasDisp = Object.keys(disp).length > 0;
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="justify-between">
        <CardTitle>Block balance</CardTitle>
        {res && (
          <span className={statusColor}>
            {res.status}
            {res.message ? ` — ${res.message}` : ""}
          </span>
        )}
      </CardHeader>
      {/* Active disposition overrides — ALWAYS shown when any exist, even if the
          solve is infeasible and the item's chip is hidden, so a forced override
          (e.g. an input cycled to export) can never soft-lock the block. */}
      {hasDisp && (
        <Callout tone="info" icon={null} className="mx-3 mt-2 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span>forced overrides:</span>
            {Object.entries(disp).map(([name, d]) => (
              <button
                key={name}
                onClick={() => doc.setDisposition(name, "auto")}
                title="click to clear this override (back to auto)"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${dispTag[d].cls} hover:brightness-110`}
              >
                <Icon kind="item" name={name} size="sm" title={res?.display?.[name] ?? name} />
                {res?.display?.[name] ?? name} {dispTag[d].label} <X className="size-3" />
              </button>
            ))}
            <button
              onClick={doc.clearDispositions}
              title="clear all forced overrides"
              className="text-muted-foreground underline hover:text-foreground"
            >
              clear all
            </button>
          </div>
        </Callout>
      )}
      {/* Planned spoil losses (#20) — always visible when set: the pinned
          surplus never reaches the boundary flows (it rots), so without this
          strip a planned loss would be invisible. */}
      {Object.keys(spoilRates).length > 0 && (
        <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 border border-warning/30 bg-warning/10 px-2 py-1.5 text-sm">
          <span className="flex items-center gap-1 text-warning">
            <Timer className="size-3" /> planned spoil losses:
          </span>
          {Object.entries(spoilRates).map(([name, r]) => (
            <button
              key={name}
              onClick={() => onOpenSpoilDialog(name)}
              title="production is sized to cover this rot rate — click to edit"
              className="inline-flex items-center gap-1 bg-warning/20 px-1.5 py-0.5 text-warning hover:brightness-110"
            >
              <Icon kind="item" name={name} size="sm" title={res?.display?.[name] ?? name} />
              {res?.display?.[name] ?? name} {num(r)}/s
            </button>
          ))}
        </div>
      )}
      {res?.status === "infeasible" ? (
        <Callout tone="destructive" className="m-3 p-3">
          {/* Only a genuine reverse-running cycle gets the "chain runs backward"
              story; any other infeasibility shows the solver's own reason. */}
          {res.negativeRecipes?.length ? (
            <>
              <div className="mb-2 font-semibold">
                Chain runs backward — a loop has no raw feed. Recipes in red below would run in
                reverse.
              </div>
              {res.stuckItems?.length ? (
                <>
                  <div className="mb-1 text-muted-foreground">
                    Starved loop items — click one to add a recipe that feeds it:
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res.stuckItems.map((n) => (
                      <ItemChip
                        key={n}
                        name={n}
                        kind="item"
                        display={res.display?.[n]}
                        link="import"
                        craftable={producible.has(n)}
                        onClick={() => onMakeFor(n)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  Mark a cycling item as <span className="font-semibold">import</span>, or add a
                  recipe that supplies the loop.
                </div>
              )}
            </>
          ) : (
            <div className="font-semibold">
              {res.message ?? "This block has no exact solution. Adjust a target or recipe."}
            </div>
          )}
        </Callout>
      ) : (
        <>
          {res?.unmadeTargets?.length && !res.broken ? (
            <div className="border-b border-border px-3 py-2 text-sm text-warning">
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertTriangle className="size-3.5 shrink-0" />
                {res.unmadeTargets.length === 1 ? "Goal has" : "Goals have"} no recipe yet — add one
                to make {res.unmadeTargets.length === 1 ? "it" : "them"}:
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {res.unmadeTargets.map((n) => (
                  <ItemChip
                    key={n}
                    name={n}
                    kind={kindOf(n)}
                    display={res.display?.[n]}
                    link="target"
                    onClick={() => onMakeFor(n)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {res?.unusedRecipes?.length && !res.broken ? (
            <div className="border-b border-border px-3 py-2 text-sm text-destructive">
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertTriangle className="size-3.5 shrink-0" />
                {res.unusedRecipes.length === 1
                  ? "1 recipe isn't"
                  : `${res.unusedRecipes.length} recipes aren't`}{" "}
                used by this block&apos;s goal — pinned to 0. Remove{" "}
                {res.unusedRecipes.length === 1 ? "it" : "them"}, or balance an item to connect{" "}
                {res.unusedRecipes.length === 1 ? "it" : "them"}:
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {res.unusedRecipes.map((n) => (
                  <span key={n} className="flex min-w-0 items-center gap-1">
                    <Icon kind="recipe" name={n} size="md" noHover />
                    <span className="truncate">{res.display?.[n] ?? n}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {res && res.tempWarnings?.length > 0 && (
            <div className="border-b border-border px-3 py-2 text-sm text-warning">
              {res.tempWarnings.map((w) => (
                <div
                  key={`${w.producer}-${w.consumer}-${w.item}-${w.temp}`}
                  className="flex items-center gap-1"
                  title="the solver links fluids by name and pools all temperatures — in-game this producer's output can't feed this consumer"
                >
                  <AlertTriangle className="size-3.5 shrink-0" />{" "}
                  {res.recipeDisplay?.[w.producer] ?? w.producer} makes{" "}
                  {res.display?.[w.item] ?? w.item} at {fmtTemp(w.temp)}, but{" "}
                  {res.recipeDisplay?.[w.consumer] ?? w.consumer} needs {w.needs}
                </div>
              ))}
            </div>
          )}
          {res &&
            (res.power.totalW > 0 ||
              res.power.heatW > 0 ||
              Math.abs(res.power.pollutionPerMin) > 0.005) && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-2 text-sm">
                {res.power.totalW > 0 && (
                  <span className="flex items-center gap-1 text-info">
                    <Zap className="size-3.5" /> {fmtW(res.power.totalW)}{" "}
                    <span className="text-muted-foreground">electric</span>
                  </span>
                )}
                {Math.abs(res.power.pollutionPerMin) > 0.005 && (
                  <span
                    className={`flex items-center gap-1 ${res.power.pollutionPerMin < 0 ? "text-success" : "text-warning/80"}`}
                    title="pollution per minute from this block's machines (base emissions × energy-consumption × pollution module effects; fuel-type multipliers not modelled). Negative = net absorption — Py forestry and plantations soak pollution like trees."
                  >
                    <Cloud className="size-3.5" /> {num(Math.abs(res.power.pollutionPerMin))}
                    <span className="text-muted-foreground">
                      pollution/min{res.power.pollutionPerMin < 0 ? " absorbed" : ""}
                    </span>
                  </span>
                )}
                {res.power.heatW > 0 && (
                  <span
                    className="flex items-center gap-1 text-warning"
                    title="Heat-powered buildings (Py hard mode). Heat doesn't travel far (~15 tiles), so a heat source — e.g. a py-heat-exchanger — must be built LOCAL to this block."
                  >
                    <Flame className="size-3.5" /> {fmtW(res.power.heatW)}{" "}
                    <span className="text-muted-foreground">heat · local source needed</span>
                  </span>
                )}
              </div>
            )}
          <div className={`grid gap-4 p-3 ${res?.exports.length ? "grid-cols-2" : "grid-cols-1"}`}>
            <div>
              <div className="mb-1 text-sm font-semibold text-warning">
                Imports — bring these in{" "}
                <span className="inline-flex items-center gap-0.5 font-normal text-muted-foreground">
                  (dashed <Plus className="inline size-3" /> = craftable in-block)
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {res?.imports.length ? (
                  res.imports.map((f) => (
                    <span key={f.name} className="group flex flex-col items-start gap-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <ItemChip
                          name={f.name}
                          kind={f.kind}
                          display={res.display?.[f.name]}
                          rate={f.rate}
                          link="import"
                          craftable={producible.has(f.name)}
                          fuel={fuelSet.has(f.name)}
                          disp={disp[f.name]}
                          onClick={() => onMakeFor(f.name)}
                          onCycleDisp={() => doc.cycleDisposition(f.name)}
                          onClearDisp={() => doc.setDisposition(f.name, "auto")}
                          onContext={(e) =>
                            onCtxMenu(e, { name: f.name, kind: f.kind, link: "import" })
                          }
                        />
                        {/* Locked-as-block-driver state (set via right-click → "Size block by this
                            input"): edit its rate inline + an unlock control. The toggle itself
                            lives in the context menu, so non-locked rows stay uncluttered. */}
                        {lockedInput === f.name && (
                          <>
                            <Input
                              type="number"
                              value={lockedRate}
                              step="0.01"
                              min="0"
                              autoFocus
                              onChange={(e) => onLockedRateChange(Number(e.target.value) || 0)}
                              title="locked rate — the block is sized to consume this much of this input"
                              className="h-7 w-16 border-info/60 px-1"
                            />
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={onUnlock}
                              title="unlock — the Goal rate is editable again"
                              className="text-info"
                            >
                              <Lock className="size-3.5" />
                            </Button>
                          </>
                        )}
                        {freed.has(f.name) && !disp[f.name] && (
                          <button
                            title="recycle loop won't self-close — auto-sourced here. Click to pin it as an import (resolves the relaxed solve)."
                            onClick={() => doc.setDisposition(f.name, "import")}
                            className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                          >
                            loop · pin import
                          </button>
                        )}
                      </span>
                      {logi.resolved && f.kind === "item" && (
                        <LogiTag
                          resolved={logi.resolved}
                          rate={f.rate}
                          machineCount={0}
                          showBelts={logi.showBelts}
                          showInserters={logi.showInserters}
                          launch={logi.launchInfo(f.name, f.rate)}
                        />
                      )}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">none — nothing to bring in</span>
                )}
              </div>
            </div>
            {!!res?.exports.length && (
              <div>
                <div className="mb-1 text-sm font-semibold text-surplus">
                  Exports — surplus, nothing consumes these
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {res.exports.map((f) => (
                    <span key={f.name} className="flex flex-col items-start gap-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <ItemChip
                          name={f.name}
                          kind={f.kind}
                          display={res.display?.[f.name]}
                          rate={f.rate}
                          link="export"
                          fuel={fuelSet.has(f.name)}
                          disp={disp[f.name]}
                          onClick={() => onUseFor(f.name)}
                          onCycleDisp={() => doc.cycleDisposition(f.name)}
                          onClearDisp={() => doc.setDisposition(f.name, "auto")}
                          onContext={(e) =>
                            onCtxMenu(e, { name: f.name, kind: f.kind, link: "export" })
                          }
                        />
                        {freed.has(f.name) && !disp[f.name] && (
                          <button
                            title="recycle loop won't self-close — auto-sunk here. Click to pin it as an export (resolves the relaxed solve)."
                            onClick={() => doc.setDisposition(f.name, "export")}
                            className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                          >
                            loop · pin export
                          </button>
                        )}
                        {/* incidental-spoil risk (#20): a SURPLUS spoilable is the
                            one that actually sits around long enough to rot */}
                        {spoilables[f.name] != null && (
                          <button
                            title={`spoils in ${fmtSpoilTime(spoilables[f.name])} — surplus sits in storage, so it WILL rot unless something consumes it. Click to plan the loss so production covers it.`}
                            onClick={() => onOpenSpoilDialog(f.name)}
                            className="flex items-center gap-1 bg-warning/15 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                          >
                            <Timer className="size-3.5" /> rots in{" "}
                            {fmtSpoilTime(spoilables[f.name])}
                          </button>
                        )}
                      </span>
                      {logi.resolved && f.kind === "item" && (
                        <LogiTag
                          resolved={logi.resolved}
                          rate={f.rate}
                          machineCount={0}
                          showBelts={logi.showBelts}
                          showInserters={logi.showInserters}
                          launch={logi.launchInfo(f.name, f.rate)}
                        />
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
