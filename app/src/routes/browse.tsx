import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Droplet, Flame, FlaskConical, Lock, Timer } from "lucide-react";
import { browseDetailFn, searchAllFn, statsFn } from "../server/factorio";
import { IconProvider, Icon } from "../lib/icons";
import { RecipeHover } from "../lib/recipe-card";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Input } from "#/components/ui/input.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";

/** The item/fluid browser. `sel` lives in the URL so every view is linkable
 * and back/forward walks your browse history. */
export const Route = createFileRoute("/browse")({
  validateSearch: (s: Record<string, unknown>): { sel?: string } =>
    typeof s.sel === "string" && s.sel ? { sel: s.sel } : {},
  component: () => (
    <IconProvider>
      <Browse />
    </IconProvider>
  ),
});

const num = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return `${r}`;
};

type Kind = "item" | "fluid";

function Browse() {
  const { sel } = Route.useSearch();
  const navigate = useNavigate({ from: "/browse" });
  const [query, setQuery] = useState("");

  const stats = useQuery({ queryKey: ["stats"], queryFn: () => statsFn() });
  const results = useQuery({
    queryKey: ["searchAll", query],
    queryFn: () => searchAllFn({ data: query }),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({
    queryKey: ["browseDetail", sel],
    queryFn: () => browseDetailFn({ data: sel! }),
    enabled: !!sel,
    placeholderData: keepPreviousData,
  });

  const open = (name: string) => void navigate({ search: { sel: name } });

  return (
    <SidebarShell
      className="font-mono text-sm text-foreground"
      width="w-72"
      label="Browse"
      sidebar={
        <>
          <div className="border-b border-border p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Browse
              </span>
              <HelpButton title="What is Browse?">
                <p>
                  Search every <span className="text-foreground">item and fluid</span> in the loaded
                  Pyanodons data. Pick one to see its recipes — what makes it, what it&apos;s used
                  in — plus its properties (stack size, fuel value, spoilage, temperatures, and so
                  on).
                </p>
                <p>
                  Use it to explore Py&apos;s tangled recipe graph, and to find the{" "}
                  <span className="text-foreground">internal names</span> that blocks and the
                  assistant refer to (e.g. <span className="text-foreground">iron-pulp-07</span>).
                </p>
              </HelpButton>
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search items & fluids…"
              autoFocus
            />
            {stats.data && (
              <div className="mt-1.5 text-xs text-muted-foreground">
                {stats.data.recipes.toLocaleString()} recipes · {stats.data.items.toLocaleString()}{" "}
                items · {stats.data.fluids} fluids
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-1">
            {query.trim().length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                type to search — results are clickable, as is every icon in the detail pane
              </div>
            )}
            {results.data?.map((r) => (
              <button
                key={`${r.kind}/${r.name}`}
                onClick={() => open(r.name)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted ${
                  sel === r.name ? "bg-accent" : ""
                }`}
                title={r.display ?? r.name}
              >
                <Icon kind={r.kind as Kind} name={r.name} size="sm" noTitle />
                <span className="min-w-0 flex-1 truncate">{r.display ?? r.name}</span>
                {r.kind === "fluid" && (
                  <span className="text-sky-300" title="fluid">
                    <Droplet className="size-3.5" />
                  </span>
                )}
              </button>
            ))}
            {query && results.data?.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">no matches</div>
            )}
          </div>
        </>
      }
    >
      {/* Detail pane */}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!sel && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            search on the left, or click any icon anywhere to inspect it
          </div>
        )}
        {detail.data && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Icon kind={detail.data.kind as Kind} name={detail.data.name} size="lg" noTitle />
              <div>
                <div className="text-lg font-bold">{detail.data.display}</div>
                <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                  {detail.data.name} · {detail.data.kind}
                  {detail.data.item?.stackSize != null && ` · stack ${detail.data.item.stackSize}`}
                  {detail.data.item?.fuelValueJ != null && (
                    <span className="inline-flex items-center gap-1">
                      · <Flame className="size-3.5" /> {fmtJ(detail.data.item.fuelValueJ)} (
                      {detail.data.item.fuelCategory})
                    </span>
                  )}
                  {detail.data.fluid?.fuelValueJ != null && (
                    <span className="inline-flex items-center gap-1">
                      · <Flame className="size-3.5" /> {fmtJ(detail.data.fluid.fuelValueJ)}/unit
                    </span>
                  )}
                  {detail.data.item?.burntResult && ` · burns to ${detail.data.item.burntResult}`}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <RecipeList
                title={`Produced by (${detail.data.producedBy.length})`}
                cards={detail.data.producedBy}
                focus={detail.data.name}
                onPick={open}
              />
              <RecipeList
                title={`Consumed by (${detail.data.consumedBy.length})`}
                cards={detail.data.consumedBy}
                focus={detail.data.name}
                onPick={open}
              />
            </div>
          </>
        )}
      </div>
    </SidebarShell>
  );
}

const fmtJ = (j: number) =>
  j >= 1e9
    ? `${(j / 1e9).toFixed(1)} GJ`
    : j >= 1e6
      ? `${(j / 1e6).toFixed(1)} MJ`
      : `${(j / 1e3).toFixed(0)} kJ`;

type Cards = NonNullable<Awaited<ReturnType<typeof browseDetailFn>>>["producedBy"];

function RecipeList({
  title,
  cards,
  focus,
  onPick,
}: {
  title: string;
  cards: Cards;
  focus: string;
  onPick: (name: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 25;
  const shown = showAll ? cards : cards.slice(0, LIMIT);
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="normal-case">{title}</CardTitle>
      </CardHeader>
      {cards.length === 0 && (
        <div className="px-3 pb-3 text-muted-foreground">
          {title.startsWith("Produced") ? "nothing makes this — a raw input" : "no consumers"}
        </div>
      )}
      {shown.map((c) => (
        <RecipeRow key={c.name} card={c} focus={focus} onPick={onPick} />
      ))}
      {cards.length > LIMIT && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full border-t border-border px-3 py-2 text-left text-xs text-sky-400 hover:bg-muted"
        >
          show all {cards.length}…
        </button>
      )}
    </Card>
  );
}

/** One recipe: name + lock state, then its io with every component clickable. */
function RecipeRow({
  card,
  focus,
  onPick,
}: {
  card: Cards[number];
  focus: string;
  onPick: (name: string) => void;
}) {
  const turd = card.unlocks.find((u) => u.isTurdSub);
  const lock = card.enabled
    ? null
    : turd
      ? {
          cls: turd.turdSelected ? "text-emerald-300" : "text-fuchsia-300",
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
      : card.unlocks.length
        ? {
            cls: "text-muted-foreground",
            text: (
              <>
                <Lock className="size-3.5" /> {card.unlocks[0].display}
                {card.unlocks.length > 1 ? ` +${card.unlocks.length - 1}` : ""}
              </>
            ),
            title: `unlocked by: ${card.unlocks.map((u) => u.display).join(", ")}`,
          }
        : {
            cls: "text-muted-foreground",
            text: (
              <>
                <Lock className="size-3.5" /> locked
              </>
            ),
            title: "no unlocking technology found",
          };

  const Comp = ({
    c,
    dim,
  }: {
    c: { kind: string; name: string; display: string | null; amount: number };
    dim?: boolean;
  }) => (
    <button
      onClick={() => onPick(c.name)}
      title={`${c.display ?? c.name} ×${num(c.amount)}`}
      className={`flex items-center gap-0.5 rounded px-0.5 hover:bg-accent ${
        c.name === focus ? "ring-1 ring-primary/60" : ""
      } ${dim ? "opacity-80" : ""}`}
    >
      <Icon kind={c.kind as Kind} name={c.name} size="sm" noTitle />
      <span className="text-xs">{num(c.amount)}</span>
    </button>
  );

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <RecipeHover
          name={card.name}
          className="flex min-w-0 basis-full items-center gap-1.5 md:basis-auto"
        >
          <Icon kind="recipe" name={card.name} size="sm" noTitle />
          <span className="truncate" title={card.display ?? card.name}>
            {card.display ?? card.name}
          </span>
        </RecipeHover>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Timer className="size-3.5" /> {num(card.energyRequired ?? 0.5)}s
        </span>
        {lock && (
          <span className={`inline-flex items-center gap-1 text-xs ${lock.cls}`} title={lock.title}>
            {lock.text}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {card.machines.slice(0, 4).map((m) => (
            <Icon key={m.name} kind="item" name={m.name} size="sm" title={m.display ?? m.name} />
          ))}
          {card.machines.length > 4 && (
            <span className="text-xs text-muted-foreground">+{card.machines.length - 4}</span>
          )}
        </span>
      </div>
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
