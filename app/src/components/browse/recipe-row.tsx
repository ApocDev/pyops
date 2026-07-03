import { Check, FlaskConical, Lock, Timer } from "lucide-react";
import type { browseDetailFn } from "../../server/factorio";
import { Button } from "#/components/ui/button.tsx";
import { Icon } from "../../lib/icons";
import { RecipeHover, TechLine } from "../../lib/recipe-card";
import { fmtCost } from "../block/format.ts";

/** One enriched recipe card of the browse detail (economy + availability, #97). */
export type BrowseCard = NonNullable<
  Awaited<ReturnType<typeof browseDetailFn>>
>["producedBy"][number];

type Kind = "item" | "fluid";

const num = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return `${r}`;
};

/** One recipe of the explorer list: name, cost + waste + relative-flow context,
 * lock/TURD state, machines, and its io with every component clickable (that's
 * how you walk the recipe graph). */
export function RecipeRow({
  card,
  focus,
  maxFlow,
  onPick,
}: {
  card: BrowseCard;
  focus: string;
  /** largest economy flow in the surrounding list — this row's meter is relative to it */
  maxFlow: number;
  onPick: (name: string) => void;
}) {
  const turd = card.unlocks.find((u) => u.isTurdSub);
  const lock = card.enabled
    ? null
    : turd
      ? {
          cls: turd.turdSelected ? "text-success" : "text-surplus",
          text: turd.turdSelected ? (
            <>
              <FlaskConical className="size-3.5" /> {turd.display} <Check className="size-3.5" />
            </>
          ) : (
            <>
              <FlaskConical className="size-3.5" /> TURD: {turd.display}
            </>
          ),
          title: turd.turdSelected
            ? "granted by your selected TURD choice"
            : "requires this TURD choice — pick it on the TURD page",
        }
      : null;

  const Comp = ({
    c,
    dim,
  }: {
    c: { kind: string; name: string; display: string | null; amount: number };
    dim?: boolean;
  }) => (
    <Button
      variant="ghost"
      onClick={() => onPick(c.name)}
      title={`${c.display ?? c.name} ×${num(c.amount)}`}
      className={`h-auto gap-0.5 px-0.5 py-0 font-normal hover:bg-accent ${
        c.name === focus ? "ring-1 ring-primary/60" : ""
      } ${dim ? "opacity-80" : ""}`}
    >
      <Icon kind={c.kind as Kind} name={c.name} size="sm" noTitle />
      <span className="text-sm">{num(c.amount)}</span>
    </Button>
  );

  const wastePct = card.waste != null ? Math.round(card.waste * 100) : null;

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <RecipeHover
          name={card.name}
          className="flex min-w-0 basis-full items-center gap-1.5 md:basis-auto"
        >
          <Icon kind="recipe" name={card.name} size="sm" noHover />
          <span className="truncate" title={card.display ?? card.name}>
            {card.display ?? card.name}
          </span>
        </RecipeHover>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Timer className="size-3.5" /> {num(card.energyRequired ?? 0.5)}s
        </span>
        {card.cost != null && (
          <span
            className="text-sm text-muted-foreground"
            title="estimated cost per craft (cost analysis)"
          >
            ¥{fmtCost(card.cost)}
          </span>
        )}
        {wastePct != null && wastePct >= 5 && (
          <span
            className={`text-sm ${
              wastePct >= 90
                ? "text-destructive"
                : wastePct >= 50
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
            title="share of the input + processing value this recipe destroys (cost analysis) — high waste means its products return far less than they cost"
          >
            {wastePct}% waste
          </span>
        )}
        {lock && (
          <span className={`inline-flex items-center gap-1 text-sm ${lock.cls}`} title={lock.title}>
            {lock.text}
          </span>
        )}
        {!card.enabled && !turd && card.unlocks.length > 0 && (
          <TechLine
            unlock={card.unlocks[0]}
            more={card.unlocks.length - 1}
            researched={card.avail.research === "available"}
          />
        )}
        {!card.enabled && !turd && card.unlocks.length === 0 && (
          <span
            className="flex items-center gap-1 text-sm text-muted-foreground"
            title="no technology unlocks this recipe"
          >
            <Lock className="size-3.5" /> locked
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {card.flow != null && maxFlow > 0 && (
            <span
              className="block h-1.5 w-10 overflow-hidden bg-muted"
              title="estimated economy flow (relative to the busiest recipe here) — how much a sensible economy actually runs this recipe, per the cost analysis"
            >
              <span
                className="block h-full bg-info"
                style={{ width: `${Math.round((Math.min(card.flow, maxFlow) / maxFlow) * 100)}%` }}
              />
            </span>
          )}
          <span className="flex items-center gap-0.5">
            {card.machines.slice(0, 4).map((m) => (
              <Icon key={m.name} kind="item" name={m.name} size="sm" title={m.display ?? m.name} />
            ))}
            {card.machines.length > 4 && (
              <span className="text-sm text-muted-foreground">+{card.machines.length - 4}</span>
            )}
          </span>
        </span>
      </div>
      {card.superseded && (
        <div
          className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
          title={`your ${card.superseded.masterDisplay ?? "TURD"} choice "${card.superseded.subDisplay}" replaced this recipe with "${card.superseded.newDisplay}" — the base version no longer exists in-game`}
        >
          <FlaskConical className="size-3.5" /> replaced by {card.superseded.newDisplay}
          <span className="text-muted-foreground/70">
            ({card.superseded.masterDisplay ?? "TURD"} › {card.superseded.subDisplay})
          </span>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {card.ingredients.map((c, i) => (
          <Comp key={`i${i}`} c={c} />
        ))}
        <span className="text-muted-foreground">→</span>
        {card.products.map((c, i) => (
          <Comp key={`p${i}`} c={c} dim={(c.probability ?? 1) < 1} />
        ))}
      </div>
    </div>
  );
}
