import { useStore } from "@tanstack/react-store";
import { AlertTriangle, Cloud, Flame, Lock, Plus, Timer, X, Zap } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { fmtSpoilTime, Icon, useSpoilables } from "../../lib/icons";
import { fmtTemp } from "../../lib/format";
import { ItemChip, type Link as ItemLink } from "./item-chip.tsx";
import { LogiTag } from "./logi-tag.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { fmtW, num } from "./format.ts";

/** The Block balance card: solve status, made-here and planned-spoil strips,
 * the root-cause (IIS) cards on an infeasible solve, the unmade/temperature
 * warnings, the power line, and the imports/exports chip lists with the
 * sizing-lock controls. */
export function BalanceCard({
  doc,
  res,
  statusColor,
  kindOf,
  producible,
  fuelSet,
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
  const made = useStore(doc.store, (s) => s.made);
  const spoilRates = useStore(doc.store, (s) => s.spoilRates);
  const spoilables = useSpoilables();
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
      {/* Made-here marks (#91) — the block's claimed in-block production. Always
          visible when any exist (even on an infeasible solve) so a mark can
          never soft-lock the block: click × to unmark (the item goes free —
          imports its shortfall, exports its surplus). */}
      {!!made?.size && (
        <Callout tone="info" icon={null} className="mx-3 mt-2 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span>made in this block:</span>
            {[...made]
              .sort((a, b) => a.localeCompare(b))
              .map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    doc.unmark(name);
                    doc.note(`Unmark "${res?.display?.[name] ?? name}" (import instead)`);
                  }}
                  title="production here covers consumption (surplus exports). Click to unmark — the item imports instead."
                  className="inline-flex items-center gap-1 bg-success/15 px-1.5 py-0.5 text-success ring-1 ring-success/30 hover:brightness-110"
                >
                  <Icon
                    kind={kindOf(name)}
                    name={name}
                    size="sm"
                    title={res?.display?.[name] ?? name}
                  />
                  {res?.display?.[name] ?? name} <X className="size-3" />
                </button>
              ))}
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
          {res.diagnosis?.length ? (
            <div className="flex flex-col gap-3">
              {res.diagnosis.map((card, ci) => (
                <div key={ci}>
                  <div className="mb-1 font-semibold">
                    These can&apos;t all hold — fixing any one repairs the block:
                  </div>
                  <div className="flex flex-col gap-1">
                    {card.members.map((m, mi) => {
                      const prov = m.prov;
                      const short = m.shortBy > 1e-6 ? ` — short ${num(m.shortBy)}/s` : "";
                      if (prov.type === "goal")
                        return (
                          <div key={mi} className="flex flex-wrap items-center gap-1.5">
                            <span>
                              goal: {res.display?.[prov.item] ?? prov.item}{" "}
                              {prov.rate < 0
                                ? `consume ≥ ${num(-prov.rate)}/s`
                                : `≥ ${num(prov.rate)}/s`}
                              {short}
                            </span>
                          </div>
                        );
                      if (prov.type === "made")
                        return (
                          <div key={mi} className="flex flex-wrap items-center gap-1.5">
                            <span>
                              made here: {res.display?.[prov.item] ?? prov.item}
                              {"qualifier" in m && typeof m.qualifier === "string"
                                ? ` at ${m.qualifier}`
                                : ""}
                              {short}
                            </span>
                            <button
                              onClick={() => {
                                doc.unmark(prov.item);
                                doc.note(
                                  `Unmark "${res.display?.[prov.item] ?? prov.item}" (import instead)`,
                                );
                              }}
                              className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                            >
                              import it instead
                            </button>
                            {producible.has(prov.item) && (
                              <button
                                onClick={() => onMakeFor(prov.item)}
                                className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                              >
                                add a producer
                              </button>
                            )}
                          </div>
                        );
                      // pin members: name the recipe + offer one-click removal
                      const label =
                        prov.type === "pin-share"
                          ? `share pin: ${Math.round(prov.share * 100)}% of ${res.display?.[prov.item] ?? prov.item} into ${res.recipeDisplay?.[prov.recipe] ?? prov.recipe}`
                          : `${prov.type === "pin-rate" ? "fixed" : "built"} count on ${res.recipeDisplay?.[prov.recipe] ?? prov.recipe}`;
                      return (
                        <div key={mi} className="flex flex-wrap items-center gap-1.5">
                          <span>
                            {label}
                            {short}
                          </span>
                          <button
                            onClick={() => {
                              doc.clearPin(
                                prov.recipe,
                                prov.type === "pin-share" ? { item: prov.item } : undefined,
                              );
                              doc.note(
                                `Remove pin on "${res.recipeDisplay?.[prov.recipe] ?? prov.recipe}"`,
                              );
                            }}
                            className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                          >
                            remove pin
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-semibold">
              {res.message ?? "This block has no exact solution. Adjust a target or recipe."}
            </div>
          )}
        </Callout>
      ) : (
        <>
          {res?.unmade?.length && !res.broken ? (
            <div className="border-b border-border px-3 py-2 text-sm text-warning">
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertTriangle className="size-3.5 shrink-0" />
                No recipe makes {res.unmade.length === 1 ? "this" : "these"} yet — add one:
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {res.unmade.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1">
                    <ItemChip
                      name={n}
                      kind={kindOf(n)}
                      display={res.display?.[n]}
                      link="target"
                      onClick={() => onMakeFor(n)}
                    />
                    {/* temperature qualifier (#110): which variant is missing */}
                    {res.unmadeTemp?.[n] && (
                      <span className="text-sm text-muted-foreground">at {res.unmadeTemp[n]}</span>
                    )}
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
                          onClick={() => onMakeFor(f.name)}
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
                          onClick={() => onUseFor(f.name)}
                          onContext={(e) =>
                            onCtxMenu(e, { name: f.name, kind: f.kind, link: "export" })
                          }
                        />
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
