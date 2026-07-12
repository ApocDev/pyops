import { Check, FlaskConical, Lock, Timer } from "lucide-react";
import type { browseDetailFn } from "../../server/factorio";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
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
  variant = "dense",
}: {
  card: BrowseCard;
  focus: string;
  /** largest economy flow in the surrounding list — this row's meter is relative to it */
  maxFlow: number;
  onPick: (name: string) => void;
  variant?: "dense" | "comfortable";
}) {
  const comfortable = variant === "comfortable";
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
      className={`h-auto font-normal hover:bg-accent ${
        comfortable
          ? "min-w-0 justify-start gap-1.5 border border-border bg-background px-1.5 py-0.5"
          : "gap-0.5 px-0.5 py-0"
      } ${c.name === focus ? "ring-1 ring-primary/60" : ""} ${dim ? "opacity-80" : ""}`}
    >
      <Icon kind={c.kind as Kind} name={c.name} size="sm" noTitle />
      {comfortable && <span className="min-w-0 truncate">{c.display ?? c.name}</span>}
      <span className={comfortable ? "ml-auto text-sm text-muted-foreground" : "text-sm"}>
        {comfortable ? "×" : ""}
        {num(c.amount)}
      </span>
    </Button>
  );

  const wastePct = card.waste != null ? Math.round(card.waste * 100) : null;

  const timingAndCost = (
    <>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Timer className="size-3.5" /> {num(card.energyRequired ?? 0.5)}s
      </span>
      {card.cost != null && (
        <Tooltip content="estimated cost per craft (cost analysis)">
          <span className="text-sm text-muted-foreground">¥{fmtCost(card.cost)}</span>
        </Tooltip>
      )}
      {wastePct != null && wastePct >= 5 && (
        <Tooltip content="share of the input + processing value this recipe destroys (cost analysis) — high waste means its products return far less than they cost">
          <span
            className={`text-sm ${
              wastePct >= 90
                ? "text-destructive"
                : wastePct >= 50
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          >
            {wastePct}% waste
          </span>
        </Tooltip>
      )}
    </>
  );

  const availability = (
    <>
      {lock && (
        <Tooltip content={lock.title}>
          <span className={`inline-flex items-center gap-1 text-sm ${lock.cls}`}>{lock.text}</span>
        </Tooltip>
      )}
      {!card.enabled && !turd && card.unlocks.length > 0 && (
        <TechLine
          unlock={card.unlocks[0]}
          more={card.unlocks.length - 1}
          researched={card.avail.research === "available"}
        />
      )}
      {!card.enabled && !turd && card.unlocks.length === 0 && (
        <Tooltip content="no technology unlocks this recipe">
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Lock className="size-3.5" /> locked
          </span>
        </Tooltip>
      )}
    </>
  );

  if (comfortable) {
    return (
      <article className="grid gap-3 border-x border-b border-border bg-card px-3 py-3 md:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <div className="flex min-w-0 items-start gap-2">
            <Icon kind="recipe" name={card.name} size="md" noHover />
            <div className="min-w-0 flex-1">
              <RecipeHover name={card.name} className="w-fit max-w-full">
                <h3 className="truncate text-base font-semibold" title={card.display ?? card.name}>
                  {card.display ?? card.name}
                </h3>
              </RecipeHover>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {timingAndCost}
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">{availability}</div>

          {card.superseded && (
            <Tooltip
              content={`your ${card.superseded.masterDisplay ?? "TURD"} choice "${card.superseded.subDisplay}" replaced this recipe with "${card.superseded.newDisplay}" — the base version no longer exists in-game`}
            >
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                <FlaskConical className="size-3.5" /> replaced by {card.superseded.newDisplay}
              </div>
            </Tooltip>
          )}

          <div className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {card.flow != null && maxFlow > 0 && (
              <Tooltip content="estimated economy activity relative to the busiest recipe in this list">
                <span className="block h-1.5 w-10 shrink-0 overflow-hidden bg-muted">
                  <span
                    className="block h-full bg-info"
                    style={{
                      width: `${Math.round((Math.min(card.flow, maxFlow) / maxFlow) * 100)}%`,
                    }}
                  />
                </span>
              </Tooltip>
            )}
            {card.machines.length > 0 && (
              <>
                <Icon kind="item" name={card.machines[0].name} size="sm" noTitle />
                <span className="truncate">
                  {card.machines[0].display ?? card.machines[0].name}
                </span>
                {card.machines.length > 1 && (
                  <Tooltip
                    content={card.machines
                      .slice(1)
                      .map((machine) => machine.display ?? machine.name)
                      .join(", ")}
                  >
                    <span className="shrink-0">+{card.machines.length - 1}</span>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-1 text-sm font-medium text-muted-foreground md:sr-only">Inputs</div>
          <div className="flex flex-wrap gap-1.5">
            {card.ingredients.length ? (
              card.ingredients.map((c, i) => <Comp key={`i${i}`} c={c} />)
            ) : (
              <span className="text-sm text-muted-foreground">None</span>
            )}
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-1 text-sm font-medium text-muted-foreground md:sr-only">Outputs</div>
          <div className="flex flex-wrap gap-1.5">
            {card.products.map((c, i) => (
              <Comp key={`p${i}`} c={c} dim={(c.probability ?? 1) < 1} />
            ))}
          </div>
        </section>
      </article>
    );
  }

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
        {timingAndCost}
        {availability}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {card.flow != null && maxFlow > 0 && (
            <Tooltip content="estimated economy flow (relative to the busiest recipe here) — how much a sensible economy actually runs this recipe, per the cost analysis">
              <span className="block h-1.5 w-10 overflow-hidden bg-muted">
                <span
                  className="block h-full bg-info"
                  style={{
                    width: `${Math.round((Math.min(card.flow, maxFlow) / maxFlow) * 100)}%`,
                  }}
                />
              </span>
            </Tooltip>
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
        <Tooltip
          content={`your ${card.superseded.masterDisplay ?? "TURD"} choice "${card.superseded.subDisplay}" replaced this recipe with "${card.superseded.newDisplay}" — the base version no longer exists in-game`}
        >
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <FlaskConical className="size-3.5" /> replaced by {card.superseded.newDisplay}
            <span className="text-muted-foreground/70">
              ({card.superseded.masterDisplay ?? "TURD"} › {card.superseded.subDisplay})
            </span>
          </div>
        </Tooltip>
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
