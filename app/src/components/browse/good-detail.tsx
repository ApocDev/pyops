import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Flame, Network, Search } from "lucide-react";
import { browseDetailFn } from "../../server/factorio";
import { recordRecent } from "../../lib/recents";
import { Icon } from "../../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { FlowStaleCallout } from "./flow-stale-callout.tsx";
import { RecipeList } from "./recipe-list.tsx";

type Kind = "item" | "fluid";

/** Full producer/consumer explorer for one good. Shared by the Browse page and
 * the global Alt+Click dialog so both surfaces expose the same decisions. */
export function GoodDetail({
  name,
  onPick,
  className = "",
  variant = "browse",
}: {
  name?: string;
  onPick: (name: string) => void;
  className?: string;
  variant?: "browse" | "dialog";
}) {
  const [recipeQuery, setRecipeQuery] = useState("");
  const [side, setSide] = useState<"recipes" | "uses">("recipes");
  useEffect(() => {
    setRecipeQuery("");
    setSide("recipes");
  }, [name]);
  const detail = useQuery({
    queryKey: ["browseDetail", name],
    queryFn: () => browseDetailFn({ data: name! }),
    enabled: !!name,
    placeholderData: keepPreviousData,
  });

  const data = detail.data;
  useEffect(() => {
    if (!data || data.name !== name) return;
    recordRecent({
      type: "good",
      name: data.name,
      goodKind: data.kind as Kind,
      display: data.display ?? data.name,
    });
  }, [data, name]);

  return (
    <div className={className}>
      {!name && (
        <EmptyState
          className="h-full"
          icon={Search}
          title="Nothing selected"
          description="Search on the left, or Alt+Click any item or fluid icon."
        />
      )}
      {name && detail.isPending && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <div className={variant === "dialog" ? "" : "grid grid-cols-1 gap-4 2xl:grid-cols-2"}>
            <Skeleton className="h-40 w-full" />
            {variant === "browse" && <Skeleton className="h-40 w-full" />}
          </div>
        </div>
      )}
      {name && detail.isError && (
        <Callout tone="destructive">failed to load this item — try again</Callout>
      )}
      {data && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Icon kind={data.kind as Kind} name={data.name} size="lg" noTitle />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{data.display}</h1>
              <div className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
                {data.name} · {data.kind}
                {data.item?.stackSize != null && ` · stack ${data.item.stackSize}`}
                {data.item?.fuelValueJ != null && (
                  <span className="inline-flex items-center gap-1">
                    · <Flame className="size-3.5" /> {fmtJ(data.item.fuelValueJ)} (
                    {data.item.fuelCategory})
                  </span>
                )}
                {data.fluid?.fuelValueJ != null && (
                  <span className="inline-flex items-center gap-1">
                    · <Flame className="size-3.5" /> {fmtJ(data.fluid.fuelValueJ)}/unit
                  </span>
                )}
                {data.item?.burntResult && ` · burns to ${data.item.burntResult}`}
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1 px-1 py-0 font-normal text-info hover:text-info"
                >
                  <Link to="/explore/dependencies" search={{ sel: data.name }}>
                    <Network className="size-3.5" /> dependencies
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {!data.flowComputed && data.producedBy.length + data.consumedBy.length > 0 && (
            <FlowStaleCallout />
          )}
          {variant === "dialog" && (
            <Segmented
              value={side}
              onValueChange={setSide}
              aria-label="Recipe explorer view"
              options={[
                { value: "recipes", label: `Recipes (${data.producedBy.length})` },
                { value: "uses", label: `Uses (${data.consumedBy.length})` },
              ]}
              className="mb-4"
            />
          )}
          {data.producedBy.length + data.consumedBy.length > 0 && (
            <FilterInput
              value={recipeQuery}
              onValueChange={setRecipeQuery}
              placeholder="filter recipes…"
              className="mb-4 max-w-sm"
            />
          )}
          {variant === "dialog" ? (
            side === "recipes" ? (
              <RecipeList
                title={`Recipes (${data.producedBy.length})`}
                cards={data.producedBy}
                focus={data.name}
                emptyText="nothing makes this — a raw input"
                query={recipeQuery}
                onClearQuery={() => setRecipeQuery("")}
                onPick={onPick}
                variant="comfortable"
              />
            ) : (
              <RecipeList
                title={`Uses (${data.consumedBy.length})`}
                cards={data.consumedBy}
                focus={data.name}
                emptyText="no consumers"
                query={recipeQuery}
                onClearQuery={() => setRecipeQuery("")}
                onPick={onPick}
                variant="comfortable"
              />
            )
          ) : (
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <RecipeList
                title={`Produced by (${data.producedBy.length})`}
                cards={data.producedBy}
                focus={data.name}
                emptyText="nothing makes this — a raw input"
                query={recipeQuery}
                onClearQuery={() => setRecipeQuery("")}
                onPick={onPick}
              />
              <RecipeList
                title={`Consumed by (${data.consumedBy.length})`}
                cards={data.consumedBy}
                focus={data.name}
                emptyText="no consumers"
                query={recipeQuery}
                onClearQuery={() => setRecipeQuery("")}
                onPick={onPick}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const fmtJ = (j: number) =>
  j >= 1e9
    ? `${(j / 1e9).toFixed(1)} GJ`
    : j >= 1e6
      ? `${(j / 1e6).toFixed(1)} MJ`
      : `${(j / 1e3).toFixed(0)} kJ`;
