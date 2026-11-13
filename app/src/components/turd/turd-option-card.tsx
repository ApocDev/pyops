import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronRight, Plus } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Icon } from "#/lib/icons.tsx";
import { RecipeHover } from "#/lib/recipe-card.tsx";
import { formatQty } from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";
import type { TurdBoardChange, TurdBoardOption } from "#/server/turd-board.server.ts";
import { TurdSwapGroups } from "./turd-swap-groups.tsx";

/** Which aligned sections a group's options show; a section no option uses is dropped. */
export type TurdSections = { module: boolean; swaps: boolean; unlocks: boolean };

const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

/** The always-on module effects a choice grants (summarized from the lowest tier). */
function moduleEffects(o: TurdBoardOption) {
  const m = o.modules[0];
  if (!m) return [];
  const suffix = o.modules.length > 1 ? " (mk01)" : "";
  return [
    m.effSpeed && {
      label: `${pct(m.effSpeed)} speed${suffix}`,
      className: "border-info/40 bg-info/15 text-info",
    },
    m.effProductivity && {
      label: `${pct(m.effProductivity)} productivity${suffix}`,
      className: "border-success/40 bg-success/15 text-success",
    },
    m.effConsumption && {
      label: `${pct(m.effConsumption)} energy${suffix}`,
      className: "border-warning/40 bg-warning/15 text-warning",
    },
    m.effPollution && {
      label: `${pct(m.effPollution)} pollution${suffix}`,
      className: "border-surplus/40 bg-surplus/15 text-surplus",
    },
  ].filter((fx) => !!fx);
}

const none = <span className="text-muted-foreground">—</span>;

/** One new recipe a choice unlocks: its name (hover for the card), then inputs → outputs. */
function NewRecipe({ change: c }: { change: TurdBoardChange }) {
  const side = (rows: NonNullable<TurdBoardChange["recipe"]>["ingredients"]) =>
    rows.map((r) => (
      <span key={`${r.kind}:${r.name}`} className="inline-flex items-center gap-0.5">
        <Icon kind={r.kind === "fluid" ? "fluid" : "item"} name={r.name} size="sm" />
        <span className="text-muted-foreground">{formatQty(r.amount)}</span>
      </span>
    ));
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <RecipeHover name={c.to} className="flex min-w-0 cursor-help items-center gap-1.5">
        <Plus className="size-3.5 shrink-0 text-success" />
        <span className="truncate">{c.toDisplay}</span>
      </RecipeHover>
      {c.recipe && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {c.recipe.ingredients.length ? side(c.recipe.ingredients) : none}
          <ArrowRight className="size-3.5 text-muted-foreground" />
          {side(c.recipe.products)}
          <span className="text-muted-foreground">{formatQty(c.recipe.energyRequired ?? 0)}s</span>
        </div>
      )}
    </div>
  );
}

/** One option of an expanded TURD group. Its sections are direct children so the
 * parent grid's subgrid rows line them up across options at wide widths; on
 * narrow screens options stack and empty sections hide. */
export function TurdOptionCard({
  option: o,
  sections,
  chosen,
  disabled,
  onChoose,
  onClear,
}: {
  option: TurdBoardOption;
  sections: TurdSections;
  chosen: boolean;
  disabled: boolean;
  onChoose: () => void;
  onClear: () => void;
}) {
  const [gameText, setGameText] = useState(false);
  const effects = moduleEffects(o);
  const swaps = o.changes.filter((c) => c.from);
  const unlocks = o.changes.filter((c) => !c.from);
  const m = o.modules[0];
  const bonus = m ? { speed: m.effSpeed, prod: m.effProductivity } : undefined;
  const cell = (empty: boolean) =>
    cn("flex min-w-0 flex-col gap-1.5 border-t border-border p-2.5", empty && "max-lg:hidden");

  return (
    <div
      data-testid="turd-option"
      className={cn(
        "grid min-w-0 border lg:row-span-(--turd-rows) lg:grid-rows-subgrid lg:gap-y-0",
        chosen ? "border-success/60 bg-success/5" : "border-border bg-background",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 p-2.5">
        <Icon kind="technology" name={o.name} size="md" />
        <span className={cn("min-w-0 font-semibold", chosen && "text-success")}>{o.display}</span>
      </div>
      {sections.module && (
        <div className={cell(!effects.length)}>
          <FieldLabel>Module</FieldLabel>
          {effects.length ? (
            <span className="flex flex-wrap gap-1">
              {effects.map((fx) => (
                <Badge key={fx.label} variant="outline" className={fx.className}>
                  {fx.label}
                </Badge>
              ))}
            </span>
          ) : (
            none
          )}
        </div>
      )}
      {sections.swaps && (
        <div className={cell(!swaps.length)}>
          <FieldLabel>Recipe changes</FieldLabel>
          {swaps.length ? <TurdSwapGroups changes={swaps} bonus={bonus} /> : none}
        </div>
      )}
      {sections.unlocks && (
        <div className={cell(!unlocks.length)}>
          <FieldLabel>New recipes</FieldLabel>
          {unlocks.length ? unlocks.map((c) => <NewRecipe key={c.to} change={c} />) : none}
        </div>
      )}
      <div className={cn(cell(false), "bg-info/5")}>
        <FieldLabel className="text-info">Your blocks</FieldLabel>
        {o.blocks.length
          ? o.blocks.map((b) => (
              <div key={b.id} className="flex min-w-0 flex-wrap items-center gap-1">
                <Badge
                  asChild
                  variant="outline"
                  className="max-w-full border-info/40 bg-info/15 text-info hover:bg-info/25"
                >
                  <Link to="/block/$id" params={{ id: String(b.id) }}>
                    <span className="truncate">{b.name}</span>
                  </Link>
                </Badge>
                {b.recipes.map((r) => (
                  <Icon key={r} kind="recipe" name={r} size="sm" />
                ))}
                {b.machines.map((mc) => (
                  <Icon key={mc} kind="entity" name={mc} size="sm" />
                ))}
              </div>
            ))
          : none}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 border-t border-border p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {chosen ? (
            <>
              <Badge variant="outline" className="border-success/40 bg-success/15 text-success">
                <Check /> Chosen
              </Badge>
              <Button
                variant="ghost"
                aria-label={`Clear ${o.display}`}
                disabled={disabled}
                onClick={onClear}
              >
                Clear
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              aria-label={`Choose ${o.display}`}
              disabled={disabled}
              onClick={onChoose}
            >
              Choose
            </Button>
          )}
          {o.description && (
            <Button
              variant="ghost"
              className="ml-auto text-muted-foreground"
              aria-expanded={gameText}
              onClick={() => setGameText((v) => !v)}
            >
              <ChevronRight className={cn("transition-transform", gameText && "rotate-90")} />
              Game text
            </Button>
          )}
        </div>
        {gameText && (
          <p className="text-sm leading-relaxed text-muted-foreground">{o.description}</p>
        )}
      </div>
    </div>
  );
}
