import { memo, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cloud } from "lucide-react";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { useSpoilables } from "../../lib/icons";
import { fmtTemp } from "../../lib/format";
import { ItemChip, type Link as ItemLink } from "./item-chip.tsx";
import { RobotStrip } from "./robot-strip.tsx";
import { SushiPlanner, type SushiPlannerFlow } from "./sushi-planner.tsx";
import { BalanceImport } from "./balance-import.tsx";
import { BalanceExport } from "./balance-export.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { num } from "./format.ts";
import { producedImportsFn } from "../../server/block-flow-status.ts";

/** The Block balance card: solve status + pollution in the header, root-cause
 * (IIS) cards on an infeasible solve, unmade/temperature warnings, and the
 * imports/exports chip lists with the
 * sizing-lock controls. Electricity and heat aren't summarised here — both
 * surface as their own import chips (pyops-electricity / pyops-heat).
 *
 * Memoized with its import and export chips (#154): the editor keeps every
 * prop reference-stable, so an edit re-renders only the chips it changed. */
export const BalanceCard = memo(function BalanceCard({
  blockId,
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
  blockId: number;
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
  const supplyPriority = useStore(doc.store, (s) => s.supplyPriority ?? 0);
  const supplyPriorities = useStore(doc.store, (s) => s.supplyPriorities ?? {});
  const campaign = useStore(doc.store, (s) => s.campaign);
  const spoilables = useSpoilables();
  const showImports = !!res && (res.displayImports.length > 0 || res.displayExports.length === 0);
  const showExports = !!res?.displayExports.length;
  // Sorted: the solve lists imports by rate, and a reorder would otherwise
  // start a new query, dropping every chip's indicator until it loads (#154).
  const importNames = res?.displayImports.map((flow) => flow.name).sort() ?? [];
  const producedImports = useQuery({
    queryKey: ["producedImports", blockId, importNames],
    queryFn: () => producedImportsFn({ data: { blockId, goods: importNames } }),
    enabled: importNames.length > 0,
    staleTime: 0,
  });
  const producedElsewhere = new Set(producedImports.data ?? []);
  // One mixed loop candidate: every solid item touching a belt in this block —
  // imports, exports, AND internal row-to-row flows all ride the same loop in
  // the "everything on one belt" pattern. A good's belt rate is
  // max(production, consumption) across the rows (that identity covers all
  // three roles); boundary-only goods (e.g. a stock goal with no row) are
  // topped up from the import/export lists.
  const sushiFlows = useMemo((): SushiPlannerFlow[] => {
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
  }, [res]);
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
            <Tooltip content="Pollution per minute from this block's machines (base emissions × energy-consumption × pollution module effects; fuel-type multipliers not modelled). Negative = net absorption — some buildings (forestry, plantations) soak pollution like trees.">
              <span
                className={`flex items-center gap-1 ${res.power.pollutionPerMin < 0 ? "text-success" : "text-warning/80"}`}
              >
                <Cloud className="size-3.5" /> {num(Math.abs(res.power.pollutionPerMin))}/min
              </span>
            </Tooltip>
          )}
          {res && (
            <span className={statusColor}>
              {res.status === "solved"
                ? "Solved"
                : res.status === "infeasible"
                  ? "Infeasible"
                  : "Error"}
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
                      const short = m.shortBy > 1e-6 ? ` — Short ${num(m.shortBy)}/s` : "";
                      if (prov.type === "goal")
                        return (
                          <div key={mi} className="flex flex-wrap items-center gap-1.5">
                            <span>
                              Goal: {res.display?.[prov.item] ?? prov.item}{" "}
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
                              Made here: {res.display?.[prov.item] ?? prov.item}
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
                              Import it instead
                            </button>
                            {producible.has(prov.item) && (
                              <button
                                onClick={() => onMakeFor(prov.item)}
                                className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                              >
                                Add a producer
                              </button>
                            )}
                          </div>
                        );
                      if (prov.type === "drain")
                        return (
                          <div key={mi} className="flex flex-wrap items-center gap-1.5">
                            <span>
                              Surplus of {res.display?.[prov.item] ?? prov.item} must be consumed
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
                              Allow export instead
                            </button>
                          </div>
                        );
                      // pin members: name the recipe + offer one-click removal
                      const label =
                        prov.type === "pin-share"
                          ? `Share pin: ${Math.round(prov.share * 100)}% of ${res.display?.[prov.item] ?? prov.item} into ${res.recipeDisplay?.[prov.recipe] ?? prov.recipe}`
                          : `${prov.type === "pin-rate" ? "Fixed" : "Built"} count on ${res.recipeDisplay?.[prov.recipe] ?? prov.recipe}`;
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
                            Remove pin
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
          {res && <RobotStrip doc={doc} res={res} logi={logi} />}
          {res?.unmade?.length && !res.broken ? (
            <div className="border-b border-border px-3 py-2 text-sm text-warning">
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertTriangle className="size-3.5 shrink-0" />
                No recipe yet — add:
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
                  content="This producer's fluid temperature is outside the consumer's accepted range, so PyOps will not route it to that recipe"
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
            className={`grid grid-cols-1 gap-4 p-3 ${showImports && showExports ? "md:grid-cols-2" : ""}`}
          >
            {showImports && (
              <div>
                <div className="mb-1 text-sm font-semibold text-warning">Imports</div>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  {res.displayImports.length ? (
                    res.qualifiedDisplayImports.map((f) => (
                      <BalanceImport
                        key={`${f.name}:${f.temperatureMode ?? ""}:${f.minTemp ?? ""}:${f.maxTemp ?? ""}`}
                        name={f.name}
                        kind={f.kind}
                        rate={f.rate}
                        temp={f.temp}
                        display={res.display?.[f.name]}
                        total={campaign ? f.rate * campaign.duration : undefined}
                        craftable={producible.has(f.name)}
                        fuel={fuelSet.has(f.name)}
                        unsourced={producedImports.isSuccess && !producedElsewhere.has(f.name)}
                        locked={lockedInput === f.name}
                        // only the locked chip shows the rate, so the others skip its edits
                        lockedRate={lockedInput === f.name ? lockedRate : 0}
                        onLockedRateChange={onLockedRateChange}
                        onUnlock={onUnlock}
                        logi={logi}
                        onMakeFor={onMakeFor}
                        onCtxMenu={onCtxMenu}
                      />
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>
            )}
            {showExports && (
              <div>
                <div className="mb-1 text-sm font-semibold text-surplus">Exports</div>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  {res.qualifiedDisplayExports.map((f) => (
                    <BalanceExport
                      key={`${f.name}:${f.temperatureMode ?? ""}:${f.minTemp ?? ""}:${f.maxTemp ?? ""}`}
                      doc={doc}
                      name={f.name}
                      kind={f.kind}
                      rate={f.rate}
                      temp={f.temp}
                      display={res.display?.[f.name]}
                      total={campaign ? f.rate * campaign.duration : undefined}
                      fuel={fuelSet.has(f.name)}
                      incidental={res.incidentalSpoilage.some((s) => s.result === f.name)}
                      inheritedPriority={supplyPriority}
                      priority={supplyPriorities[f.name]}
                      spoilTicks={spoilables[f.name]}
                      logi={logi}
                      onUseFor={onUseFor}
                      onCtxMenu={onCtxMenu}
                      onOpenSpoilDialog={onOpenSpoilDialog}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
});
