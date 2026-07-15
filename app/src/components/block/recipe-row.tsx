import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
  AlertTriangle,
  FlaskConical,
  Flame,
  GripVertical,
  Power,
  Route,
  Sparkles,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { RecipeHover } from "../../lib/recipe-card";
import { fmtSpoilTime, Icon, useSpoilables } from "../../lib/icons";
import { ModulesChip } from "../../lib/modules-modal";
import { EditableCount } from "./editable-count.tsx";
import { FluidTemperaturePicker } from "./fluid-temperature-picker.tsx";
import { IncidentalSpoilageChip } from "./incidental-spoilage-chip.tsx";
import { SortableRow } from "./sortable-row.tsx";
import { ItemChip, type Link as ItemLink } from "./item-chip.tsx";
import { LoadingFitCount } from "./loading-fit-count.tsx";
import { LogiTag } from "./logi-tag.tsx";
import { ReactorLayoutChip } from "./reactor-layout-chip.tsx";
import { RecipeSpoilageIndicator } from "./recipe-spoilage-indicator.tsx";
import type { ChipTempWarning } from "./temp-warnings.ts";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { fmtW, num } from "./format.ts";
import { cellChip } from "./styles.ts";

/** Callbacks that open the block editor's overlays from a row: pickers get the
 * recipe name, item clicks route to the recipe picker (produce/consume), and
 * the two context menus carry the click position. */
export type RowOverlayOpeners = {
  makeFor: (name: string) => void;
  useFor: (name: string) => void;
  ctxMenu: (
    e: { clientX: number; clientY: number },
    d: { name: string; kind: string; link: ItemLink },
  ) => void;
  rowMenu: (e: { clientX: number; clientY: number }, name: string) => void;
  machinePicker: (recipe: string) => void;
  fuelPicker: (recipe: string) => void;
  modulesPicker: (recipe: string) => void;
  /** apply the row's suggested module fill (the ✨ hint) as its stored picks */
  applyModuleFill: (recipe: string) => void;
  /** open the Pins dialog for a row (used to edit a cap from the count cell) */
  pinsFor: (recipe: string) => void;
  spoilageFor: (item: string) => void;
};

/** One live recipe row of the grid: name + solved rate, machine/fuel/module
 * cells, and the ingredient/product chips at the solved rates. Click any item
 * to add a producer (ingredient) or consumer (product); right-click opens the
 * good menu; right-click the name for sub-block actions. */
export function RecipeRow({
  doc,
  name,
  row,
  display,
  grouped,
  off,
  error,
  gridClass,
  confirmRemove,
  onRequestRemove,
  linkOf,
  producible,
  logi,
  open,
  tempWarnings,
  highlight,
  moduleHints,
  incidentalSpoilage,
  goodDisplay,
}: {
  doc: BlockDocStore;
  name: string;
  row: SolveResult["rows"][number] | undefined;
  display: string;
  /** member of a sub-block (#7) */
  grouped: boolean;
  /** toggled out of the solve (#73) */
  off: boolean;
  /** the block solve failed while this enabled recipe participated */
  error: boolean;
  /** pinned to 0 — nothing in the block needs it */
  gridClass: string;
  /** the click-to-confirm remove is armed on this row */
  confirmRemove: boolean;
  onRequestRemove: () => void;
  linkOf: (name: string) => ItemLink;
  /** imports a recipe could make in-block (drives the dashed craftable ring) */
  producible: ReadonlySet<string>;
  logi: LogiView;
  open: RowOverlayOpeners;
  /** per-chip fluid-temperature mismatches touching this row (#110 interim) */
  tempWarnings: { ingredient: Map<string, ChipTempWarning>; product: Map<string, ChipTempWarning> };
  /** briefly ring + scroll this row into view — set when a flow node targets it (#101) */
  highlight?: boolean;
  /** show the ambient ✨ suggestion hint (Settings toggle; apply paths always work) */
  moduleHints?: boolean;
  incidentalSpoilage: readonly { source: string; result: string; rate: number }[];
  goodDisplay?: Readonly<Record<string, string>>;
}) {
  const spoilables = useSpoilables();
  const campaign = useStore(doc.store, (s) => s.campaign);
  // Debounce the suggestion hint (#117): the suggested fill recomputes per
  // solve, so it can flip while a rate is being dragged. The sparkle only
  // appears once the suggestion has held still for a beat — mid-edit churn
  // hides it instead of blinking it.
  const suggestionKey = row?.suggestedModules?.join("\u0001") ?? "";
  const [settledSuggestion, setSettledSuggestion] = useState(false);
  useEffect(() => {
    setSettledSuggestion(false);
    if (!suggestionKey) return;
    const t = setTimeout(() => setSettledSuggestion(true), 600);
    return () => clearTimeout(t);
  }, [suggestionKey]);

  const rowPin = useStore(doc.store, (s) =>
    s.pins.find((p) => (p.kind === "count" || p.kind === "cap") && p.recipe === name),
  ) as { kind: "count" | "cap"; count: number } | undefined;
  const edgePins = useStore(doc.store, (s) =>
    s.pins.filter((p) => (p.kind === "share" || p.kind === "drain") && p.recipe === name),
  );
  const shareCount = edgePins.filter((p) => p.kind === "share").length;
  const drainItems = edgePins.flatMap((p) => (p.kind === "drain" ? [p.item] : []));
  const drainDisplay = drainItems.map((item) => goodDisplay?.[item] ?? item).join(", ");
  // v2 solver (#91): rates are ≥ 0 by construction. A row at exactly 0 is
  // idle — nothing in the block pulls it (not an error; often a parked option).
  const idle = !off && row != null && Math.abs(row.rate) < 1e-9;
  const uncertainProducts =
    row?.products.filter(
      (product) =>
        product.probability < 1 || Math.abs(product.amountMax - product.amountMin) > 1e-9,
    ) ?? [];
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  const surface = (dragging: boolean) =>
    dragging
      ? "bg-card shadow-lg"
      : off
        ? "bg-muted/30"
        : error
          ? "bg-destructive/10"
          : grouped
            ? "bg-foreground/[0.025]"
            : "";
  return (
    <SortableRow key={name} id={name}>
      {({ setActivatorNodeRef, listeners, attributes, isDragging }) => (
        <div
          ref={rowRef}
          data-recipe-row={name}
          className={`${gridClass} relative border-t border-border ${grouped ? "border-l-2 border-l-primary/50" : ""} ${surface(isDragging)} ${highlight ? "ring-2 ring-primary ring-inset" : ""}`}
        >
          <RecipeHover
            name={name}
            className={`flex min-w-0 items-center gap-2 ${grouped ? "pl-2" : ""}`}
          >
            <span
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              title="Drag to reorder this recipe"
              className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </span>
            <span
              data-recipe-row-icon={name}
              className={off ? "opacity-40" : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                open.rowMenu(e, name);
              }}
            >
              <Icon kind="recipe" name={name} size="md" noHover />
            </span>
            <span
              className={`min-w-0 flex-1 ${off ? "opacity-60" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                open.rowMenu(e, name);
              }}
            >
              <span className={`block truncate ${off ? "line-through" : ""}`} title={display}>
                {display}
              </span>
              {off ? (
                <Tooltip content="Excluded from the solve">
                  <span className="text-sm font-semibold text-muted-foreground">Disabled</span>
                </Tooltip>
              ) : error ? (
                <Tooltip content="The block solve failed — edit this row to repair it">
                  <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
                    <AlertTriangle className="size-3" /> Solve failed
                  </span>
                </Tooltip>
              ) : idle ? (
                <Tooltip content="Nothing in this block pulls it">
                  <span className="text-sm font-semibold text-muted-foreground">Idle</span>
                </Tooltip>
              ) : row ? (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  {num(row.rate)}/s
                  {campaign && (
                    <span className="tabular-nums">
                      · {num(row.rate * campaign.duration)} crafts total
                    </span>
                  )}
                  <RecipeSpoilageIndicator products={row.products} spoilables={spoilables} />
                </span>
              ) : null}
              {campaign && uncertainProducts.length > 0 && (
                <Tooltip
                  content={uncertainProducts
                    .map(
                      (product) =>
                        `${product.display ?? product.name}: ${num(product.amountMin)}–${num(product.amountMax)} each${product.probability < 1 ? ` · ${num(product.probability * 100)}% chance` : ""} · ${num(product.amountExpected * (row?.rate ?? 0) * campaign.duration)} expected total`,
                    )
                    .join("\n")}
                >
                  <span className="flex items-center gap-1 text-sm text-warning">
                    <FlaskConical className="size-3" /> Variable result · hover for range and chance
                  </span>
                </Tooltip>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className={off ? "text-muted-foreground/60" : "text-muted-foreground"}
              onClick={() => doc.toggleDisabled(name)}
              title={
                off
                  ? "Enable — include this recipe in the solve"
                  : "Disable — keep the recipe but exclude it from the solve"
              }
            >
              <Power className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size={confirmRemove ? "xs" : "icon-xs"}
              className={`shrink-0 hover:text-destructive ${confirmRemove ? "font-semibold text-destructive" : "text-muted-foreground"}`}
              onClick={onRequestRemove}
              title={confirmRemove ? "Click again to remove" : "Remove"}
            >
              {confirmRemove ? (
                <span className="whitespace-nowrap">Remove?</span>
              ) : (
                <X className="size-3.5" />
              )}
            </Button>
          </RecipeHover>
          <div className="flex flex-wrap items-center gap-2">
            <FieldLabel className="w-full md:hidden">Machines</FieldLabel>
            {row?.machine ? (
              <>
                {/* building cell: icon → picker, count → click-to-fix. The count's
                    own TINT carries the pin state (info = fixed, warning = capped),
                    so no separate =N badge. Share routing keeps its % marker (it's
                    about ingredients, not the building count). */}
                <span className="flex items-center gap-2 bg-muted/50 px-1.5 py-1 text-sm">
                  <button
                    onClick={() => open.machinePicker(name)}
                    aria-label={`Change ${row.machine.display ?? row.machine.name} building`}
                    className="flex items-center hover:brightness-125"
                  >
                    <Icon
                      kind="entity"
                      name={row.machine.name}
                      size="md"
                      extraText="Click to change building."
                    />
                  </button>
                  <span className="flex flex-col items-start">
                    <span className="flex items-center gap-1">
                      <EditableCount
                        count={row.machine.count}
                        pin={rowPin}
                        onSetCount={(n) => {
                          doc.setPin({ kind: "count", recipe: name, count: n });
                          doc.note(`Fix "${display}" at ${n} buildings`);
                        }}
                        onClear={() => {
                          doc.clearPin(name);
                          doc.note(`Unfix "${display}" building count`);
                        }}
                        onOpenPins={() => open.pinsFor(name)}
                      />
                      {shareCount > 0 && (
                        <Tooltip
                          content={`${shareCount} routed input share${shareCount > 1 ? "s" : ""}; click to manage`}
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Manage ${shareCount} routed input share${shareCount > 1 ? "s" : ""}`}
                            onClick={() => open.pinsFor(name)}
                            className="size-5 bg-info/20 text-sm text-info ring-1 ring-info/40 hover:bg-info/30 hover:text-info"
                          >
                            %
                          </Button>
                        </Tooltip>
                      )}
                      {drainItems.length > 0 && (
                        <Tooltip
                          content={`Routes all surplus ${drainDisplay} into this recipe; click to manage`}
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Routes all surplus ${drainDisplay}`}
                            onClick={() => open.pinsFor(name)}
                            className="size-5 bg-info/20 text-info ring-1 ring-info/40 hover:bg-info/30 hover:text-info"
                          >
                            <Route className="size-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                    </span>
                    {logi.resolved && logi.showInserters && (
                      <LoadingFitCount
                        logistics={logi.resolved}
                        machine={row.machine}
                        ingredients={row.ingredients}
                        products={row.products}
                        fuel={row.fuel}
                      />
                    )}
                  </span>
                </span>
                {/* electricity, when the machine draws power */}
                {row.machine.energySource === "electric" && (
                  <span
                    title="Electric power draw"
                    className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm text-info"
                  >
                    <Zap className="size-3.5" /> {fmtW(row.machine.powerW)}
                  </span>
                )}
                {row.machine.energySource === "heat" && (
                  <Tooltip content="Heat draw — must be delivered by a reactor in this block (heat doesn't travel between blocks)">
                    <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm text-warning">
                      <Flame className="size-3.5" /> {fmtW(row.machine.powerW)}
                    </span>
                  </Tooltip>
                )}
                {/* reactor farm layout (#94): neighbour bonus scales heat output */}
                {row.reactor && (
                  <ReactorLayoutChip
                    reactor={row.reactor}
                    onPick={(l) => doc.setReactorLayout(name, l)}
                  />
                )}
                {/* fuel: icon + rate; click = fuel picker. The fluid-fuel pool
                    (#25), a filtered burner's pinned fluid, and a temperature-fed
                    drain (#114) have no per-row pick, so those render as plain
                    (non-clickable) chips. */}
                {row.fuel &&
                  (row.fuel.pool || row.fuel.pinned || row.fuel.temperature ? (
                    <Tooltip
                      label
                      content={
                        row.fuel.pool
                          ? `Fluid fuel · ${fmtW(row.fuel.perSec * 1e6)} — burns any fuel-valued fluid; add a "Burn …" recipe to choose which`
                          : row.fuel.temperature
                            ? `${row.fuel.display ?? row.fuel.name} · ${num(row.fuel.perSec)}/s — drained for its heat (temperature), not burned`
                            : `${row.fuel.display ?? row.fuel.name} · ${num(row.fuel.perSec)}/s — this machine only burns ${row.fuel.display ?? row.fuel.name}`
                      }
                    >
                      <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm text-warning">
                        <Icon
                          kind={row.fuel.kind as "item" | "fluid"}
                          name={row.fuel.name}
                          size="md"
                          noTitle
                        />
                        <span className="font-semibold">
                          {row.fuel.pool ? fmtW(row.fuel.perSec * 1e6) : num(row.fuel.perSec)}
                        </span>
                      </span>
                    </Tooltip>
                  ) : (
                    <button
                      onClick={() => open.fuelPicker(name)}
                      title={`${row.fuel.display ?? row.fuel.name} · ${num(row.fuel.perSec)}/s · click to change fuel`}
                      className={`${cellChip} text-warning`}
                    >
                      <Icon
                        kind={row.fuel.kind as "item" | "fluid"}
                        name={row.fuel.name}
                        size="md"
                        noTitle
                      />
                      <span className="font-semibold">{num(row.fuel.perSec)}</span>
                    </button>
                  ))}
                {/* burnt result (ash, depleted cell): produced 1:1 from burning */}
                {row.fuel?.burnt && (
                  <Tooltip
                    content={`${row.fuel.burnt.display ?? row.fuel.burnt.name} — produced by burning`}
                  >
                    <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm text-muted-foreground">
                      →<Icon kind="item" name={row.fuel.burnt.name} size="md" noTitle />
                      <span>{num(row.fuel.burnt.perSec)}</span>
                    </span>
                  </Tooltip>
                )}
                {/* modules + beacons: configured loadout (or ghost ⊞), click to edit */}
                <ModulesChip
                  modules={row.modules}
                  beacons={row.beacons}
                  slots={row.machine.moduleSlots ?? 0}
                  effects={row.effects}
                  onClick={() => open.modulesPicker(name)}
                />
                {/* auto-fill hint: a better fill exists — click applies it */}
                {moduleHints && settledSuggestion && (
                  <button
                    onClick={() => open.applyModuleFill(name)}
                    title="Better modules available — click to apply the suggested fill (open the modules dialog to preview it)"
                    className="flex items-center px-1 py-1 text-info hover:bg-accent"
                  >
                    <Sparkles className="size-3.5" />
                  </button>
                )}
                {/* TURD: hidden modules the selected upgrades insert (no slot cost) */}
                {row.turdModules.length > 0 && (
                  <Tooltip
                    content={`TURD: ${row.turdModules.map((m) => m.display ?? m.name).join(", ")} — applied by your selected upgrades`}
                  >
                    <Link
                      to="/turd"
                      className="flex items-center gap-1 bg-primary/15 px-1.5 py-1 text-sm text-primary ring-1 ring-primary/40 hover:brightness-110"
                    >
                      <FlaskConical className="size-3.5" />
                      {row.turdModules.map((m) => (
                        <Icon key={m.name} kind="item" name={m.name} size="sm" noTitle />
                      ))}
                    </Link>
                  </Tooltip>
                )}
              </>
            ) : row?.spoil ? (
              // Spoil-buffer sizing (#19): no machine — the "cost" of a
              // spoiling step is the storage holding items mid-spoil.
              <Tooltip
                content={`Spoils in ${fmtSpoilTime(row.spoil.seconds * 60)} — at ${num(row.rate)}/s, ≈${num(row.spoil.buffer)} items sit in storage mid-spoil${row.spoil.stacks != null ? ` (≈${Math.ceil(row.spoil.stacks)} stacks @ ${row.spoil.stackSize}/stack)` : ""}`}
              >
                <span className="flex items-center gap-1.5 bg-muted/50 px-1.5 py-1 text-sm text-warning">
                  <Timer className="size-3.5 shrink-0" />
                  {fmtSpoilTime(row.spoil.seconds * 60)} · buffer {num(Math.ceil(row.spoil.buffer))}
                  {row.spoil.stacks != null && (
                    <span className="text-muted-foreground">
                      ≈ {num(Math.ceil(row.spoil.stacks))} stack
                      {Math.ceil(row.spoil.stacks) === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </Tooltip>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <FieldLabel className="w-full md:hidden">Ingredients ↓</FieldLabel>
            {row?.ingredients.map((c) => (
              <div key={c.name} className="flex flex-col items-start gap-1.5">
                <ItemChip
                  name={c.name}
                  kind={c.kind}
                  display={c.display}
                  rate={c.rate}
                  temp={
                    c.hasTemperatureVariants && (c.temperatureOptions?.length ?? 0) <= 1
                      ? c.temp
                      : null
                  }
                  temperatureControl={
                    c.kind === "fluid" &&
                    c.hasTemperatureVariants &&
                    (c.temperatureOptions?.length ?? 0) > 1 &&
                    c.acceptedTemperature ? (
                      <FluidTemperaturePicker
                        recipe={name}
                        fluid={c.name}
                        display={c.display ?? c.name}
                        accepted={c.acceptedTemperature}
                        selected={c.selectedTemperature ?? null}
                        favorite={c.favoriteTemperature ?? null}
                        options={c.temperatureOptions ?? []}
                        onChange={(temperature) => {
                          doc.pickFluidTemperature(name, c.name, temperature);
                          doc.note(
                            temperature == null
                              ? `Use ${c.acceptedTemperature} ${c.display ?? c.name}`
                              : `Use ${temperature}°C ${c.display ?? c.name}`,
                          );
                        }}
                      />
                    ) : null
                  }
                  link={linkOf(c.name)}
                  craftable={producible.has(c.name)}
                  onClick={() => open.makeFor(c.name)}
                  onContext={(e) =>
                    open.ctxMenu(e, { name: c.name, kind: c.kind, link: linkOf(c.name) })
                  }
                />
                {/* fluid-temp mismatch (#110 interim): part of this fluid is made
                    at a temperature this machine can't accept */}
                {tempWarnings.ingredient.has(c.name) && (
                  <Tooltip content={tempWarnings.ingredient.get(c.name)!.title}>
                    <span className="flex items-center gap-1 bg-warning/15 px-1.5 py-0.5 text-sm text-warning">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {tempWarnings.ingredient.get(c.name)!.label}
                    </span>
                  </Tooltip>
                )}
                {logi.resolved && c.kind === "item" && (
                  <LogiTag
                    resolved={logi.resolved}
                    rate={c.rate}
                    machineCount={row.machine?.count ?? 0}
                    showBelts={logi.showBelts}
                    showInserters={logi.showInserters}
                    launch={logi.launchInfo(c.name, c.rate)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <FieldLabel className="w-full md:hidden">Products ↑</FieldLabel>
            {row?.products.map((c) => {
              const incidental = incidentalSpoilage.filter((s) => s.source === c.name);
              return (
                <div key={c.name} className="flex flex-col items-start gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ItemChip
                      name={c.name}
                      kind={c.kind}
                      display={c.display}
                      rate={c.rate}
                      rateMin={c.rateMin}
                      rateMax={c.rateMax}
                      temp={c.temp}
                      spoilTicks={spoilables[c.name]}
                      link={linkOf(c.name)}
                      onClick={() => open.useFor(c.name)}
                      onContext={(e) =>
                        open.ctxMenu(e, { name: c.name, kind: c.kind, link: linkOf(c.name) })
                      }
                    />
                    {incidental.map((spoil) => (
                      <IncidentalSpoilageChip
                        key={`${spoil.source}:${spoil.result}`}
                        result={spoil.result}
                        resultDisplay={goodDisplay?.[spoil.result]}
                        rate={spoil.rate}
                        onEdit={() => open.spoilageFor(spoil.source)}
                      />
                    ))}
                  </div>
                  {/* fluid-temp mismatch (#110 interim): a consumer in this block
                    can't accept this output's temperature */}
                  {tempWarnings.product.has(c.name) && (
                    <Tooltip content={tempWarnings.product.get(c.name)!.title}>
                      <span className="flex items-center gap-1 bg-warning/15 px-1.5 py-0.5 text-sm text-warning">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {tempWarnings.product.get(c.name)!.label}
                      </span>
                    </Tooltip>
                  )}
                  {logi.resolved && c.kind === "item" && (
                    <LogiTag
                      resolved={logi.resolved}
                      rate={c.rate}
                      machineCount={row.machine?.count ?? 0}
                      showBelts={logi.showBelts}
                      showInserters={logi.showInserters}
                      launch={logi.launchInfo(c.name, c.rate)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SortableRow>
  );
}
