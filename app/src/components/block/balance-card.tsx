import { useStore } from "@tanstack/react-store";
import { AlertTriangle, Cloud, Lock, Timer } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { fmtSpoilTime, useSpoilables } from "../../lib/icons";
import { fmtTemp } from "../../lib/format";
import { ItemChip, type Link as ItemLink } from "./item-chip.tsx";
import { LogiTag } from "./logi-tag.tsx";
import { SushiPlanner, type SushiPlannerFlow } from "./sushi-planner.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { num } from "./format.ts";

/** The Block balance card: solve status + pollution in the header, root-cause
 * (IIS) cards on an infeasible solve, unmade/temperature warnings, and the
 * imports/exports chip lists with the
 * sizing-lock controls. Electricity and heat aren't summarised here — both
 * surface as their own import chips (pyops-electricity / pyops-heat). */
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
  const blockName = useStore(doc.store, (s) => s.blockName);
  const spoilables = useSpoilables();
  // One mixed loop candidate: every solid item touching a belt in this block —
  // imports, exports, AND internal row-to-row flows all ride the same loop in
  // the "everything on one belt" pattern. A good's belt rate is
  // max(production, consumption) across the rows (that identity covers all
  // three roles); boundary-only goods (e.g. a stock goal with no row) are
  // topped up from the import/export lists.
  const sushiFlows: SushiPlannerFlow[] = (() => {
    const solid = (f: { name: string; kind: string }) =>
      f.kind === "item" && !f.name.startsWith("pyops-");
    const prod = new Map<string, number>();
    const cons = new Map<string, number>();
    const disp = new Map<string, string | null>();
    for (const row of res?.rows ?? []) {
      for (const c of row.ingredients) {
        if (!solid(c)) continue;
        cons.set(c.name, (cons.get(c.name) ?? 0) + c.rate);
        disp.set(c.name, c.display ?? res?.display?.[c.name] ?? null);
      }
      for (const c of row.products) {
        if (!solid(c)) continue;
        prod.set(c.name, (prod.get(c.name) ?? 0) + c.rate);
        disp.set(c.name, c.display ?? res?.display?.[c.name] ?? null);
      }
    }
    for (const f of res?.imports ?? []) {
      if (!solid(f) || cons.has(f.name) || prod.has(f.name)) continue;
      cons.set(f.name, f.rate);
      disp.set(f.name, res?.display?.[f.name] ?? null);
    }
    for (const f of res?.displayExports ?? []) {
      if (!solid(f) || cons.has(f.name) || prod.has(f.name)) continue;
      prod.set(f.name, f.rate);
      disp.set(f.name, res?.display?.[f.name] ?? null);
    }
    return [...new Set([...prod.keys(), ...cons.keys()])]
      .map((name) => {
        const p = prod.get(name) ?? 0;
        const c = cons.get(name) ?? 0;
        return {
          name,
          display: disp.get(name) ?? null,
          rate: Math.max(p, c),
          role:
            p > 1e-9 && c > 1e-9 ? ("int" as const) : c > 1e-9 ? ("in" as const) : ("out" as const),
        };
      })
      .filter((f) => f.rate > 1e-9)
      .sort((a, b) => b.rate - a.rate);
  })();
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="justify-between">
        <CardTitle>Block balance</CardTitle>
        <div className="flex items-center gap-4 text-sm">
          {logi.resolved && sushiFlows.length >= 2 && (
            <SushiPlanner flows={sushiFlows} resolved={logi.resolved} blockName={blockName} />
          )}
          {/* Pollution rides in the header (#23) to save a whole body row —
              electricity/heat aren't shown here at all: both surface as their
              own import chips below (pyops-electricity / pyops-heat). */}
          {res && Math.abs(res.power.pollutionPerMin) > 0.005 && (
            <Tooltip content="pollution per minute from this block's machines (base emissions × energy-consumption × pollution module effects; fuel-type multipliers not modelled). Negative = net absorption — some buildings (forestry, plantations) soak pollution like trees.">
              <span
                className={`flex items-center gap-1 ${res.power.pollutionPerMin < 0 ? "text-success" : "text-warning/80"}`}
              >
                <Cloud className="size-3.5" /> {num(Math.abs(res.power.pollutionPerMin))}/min
              </span>
            </Tooltip>
          )}
          {res && (
            <span className={statusColor}>
              {res.status}
              {res.message ? ` — ${res.message}` : ""}
            </span>
          )}
        </div>
      </CardHeader>
      {/* The made set (#91) drives the solve but isn't listed here — the recipe
          rows already show what's produced in-block (linked green chips). Toggle
          a good's made state from its right-click menu; the IIS cards below
          offer "import it instead" per made item when a block is infeasible. */}
      {res?.status === "infeasible" ? (
        <Callout tone="destructive" className="m-3 p-3">
          {res.diagnosis?.length ? (
            <div className="flex flex-col gap-3">
              {res.diagnosis.map((card, ci) => (
                <div key={ci}>
                  <div className="mb-1 font-semibold">
                    Can&apos;t all hold — fixing one repairs the block:
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
                      if (prov.type === "drain")
                        return (
                          <div key={mi} className="flex flex-wrap items-center gap-1.5">
                            <span>
                              surplus of {res.display?.[prov.item] ?? prov.item} must be consumed
                              here (drain)
                              {short}
                            </span>
                            <button
                              onClick={() => {
                                doc.clearDrains(prov.item);
                                doc.note(
                                  `Stop draining "${res.display?.[prov.item] ?? prov.item}"`,
                                );
                              }}
                              className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                            >
                              allow export instead
                            </button>
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
                no recipe yet — add:
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
                <Tooltip
                  key={`${w.producer}-${w.consumer}-${w.item}-${w.temp}`}
                  content="the solver links fluids by name and pools all temperatures — in-game this producer's output can't feed this consumer"
                >
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="size-3.5 shrink-0" />{" "}
                    {res.recipeDisplay?.[w.producer] ?? w.producer} makes{" "}
                    {res.display?.[w.item] ?? w.item} at {fmtTemp(w.temp)}, but{" "}
                    {res.recipeDisplay?.[w.consumer] ?? w.consumer} needs {w.needs}
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
          <div
            className={`grid gap-4 p-3 ${res?.displayExports.length ? "grid-cols-2" : "grid-cols-1"}`}
          >
            <div>
              <div className="mb-1 text-sm font-semibold text-warning">Imports</div>
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
                        {/* the block imports this while an in-block recipe
                            produces it — usually the import-instead-of-make
                            trap (block 27); one click claims it in-block */}
                        {res.importedProducible?.includes(f.name) && (
                          <button
                            title="an enabled recipe in this block produces this good, but the plan imports it. Click to mark it made in-block (production must cover consumption)."
                            onClick={() => {
                              doc.markMade(f.name);
                              doc.note(`Mark "${res.display?.[f.name] ?? f.name}" made in-block`);
                            }}
                            className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                          >
                            made here? · make in-block
                          </button>
                        )}
                        {lockedInput === f.name && (
                          <>
                            <Tooltip content="locked rate — the block is sized to consume this much of this input">
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
                  <span className="text-sm text-muted-foreground">none</span>
                )}
              </div>
            </div>
            {!!res?.displayExports.length && (
              <div>
                <div className="mb-1 text-sm font-semibold text-surplus">Exports</div>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {res.displayExports.map((f) => {
                    const incidental = res.incidentalSpoilage.filter((s) => s.result === f.name);
                    return (
                      <span key={f.name} className="flex flex-col items-start gap-1.5">
                        <ItemChip
                          name={f.name}
                          kind={f.kind}
                          display={res.display?.[f.name]}
                          rate={f.rate}
                          link="export"
                          fuel={fuelSet.has(f.name)}
                          incidental={incidental.length > 0}
                          onClick={() => onUseFor(f.name)}
                          onContext={(e) =>
                            onCtxMenu(e, { name: f.name, kind: f.kind, link: "export" })
                          }
                        />
                        {/* incidental-spoil risk (#20): a SURPLUS spoilable is the
                            one that actually sits around long enough to rot — stacked
                            under the chip so it doesn't widen the export grid */}
                        {spoilables[f.name] != null && (
                          <button
                            aria-label={`estimate incidental spoilage for ${res.display?.[f.name] ?? f.name}`}
                            onClick={() => onOpenSpoilDialog(f.name)}
                            className="flex items-center gap-1 bg-warning/15 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                          >
                            <Timer className="size-3.5" /> {fmtSpoilTime(spoilables[f.name])}
                          </button>
                        )}
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
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
