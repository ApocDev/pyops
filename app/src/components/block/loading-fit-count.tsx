import { Hammer } from "lucide-react";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { loadingFit } from "../../lib/loading-fit.ts";
import type { ResolvedLogistics } from "../../lib/logistics.ts";
import { num } from "./format.ts";

/** Compact second line under the solved machine count: hammer + suggested
 * physical count. The tooltip carries the explanation and routing caveat. */
export function LoadingFitCount({
  logistics,
  machine,
  ingredients,
  products,
  fuel,
}: {
  logistics: ResolvedLogistics;
  machine: {
    count: number;
    tileWidth: number | null;
    tileHeight: number | null;
  };
  ingredients: { name: string; kind: string; rate: number }[];
  products: { name: string; kind: string; rate: number }[];
  fuel: {
    name: string;
    kind: string;
    perSec: number;
    burnt?: { name: string; perSec: number } | null;
  } | null;
}) {
  const fit = loadingFit({
    logistics,
    machineCount: machine.count,
    tileWidth: machine.tileWidth,
    tileHeight: machine.tileHeight,
    ingredients: ingredients.map((stream) => ({ ...stream, direction: "input" })),
    products: products.map((stream) => ({ ...stream, direction: "output" })),
    fuel: fuel
      ? {
          name: fuel.name,
          kind: fuel.kind,
          rate: fuel.perSec,
          burnt: fuel.burnt ? { name: fuel.burnt.name, rate: fuel.burnt.perSec } : null,
        }
      : null,
  });
  if (!fit) return null;

  const mover = logistics.moverKind === "loader" ? logistics.loader : logistics.inserter;
  const moverName = mover?.display ?? mover?.name ?? logistics.moverKind;
  const footprint = `${fit.width}×${fit.height}`;
  const reserved = [
    `${fit.itemSlots} ${logistics.moverKind}${fit.itemSlots === 1 ? "" : "s"}`,
    fit.fluidSlots > 0
      ? `${fit.fluidSlots} pipe connection${fit.fluidSlots === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" + ");

  if (fit.recommendedBuildings == null) {
    const content = `No adjacent loading fit: this ${footprint} building has ${fit.accessSlots} perimeter positions, but at least ${fit.usedSlots} are needed (${reserved}) even at minimum throughput. This checks access positions only; it does not prove belts or pipes can be routed.`;
    return (
      <Tooltip content={content}>
        <span
          aria-label="No adjacent loading fit"
          className="inline-flex items-center gap-1 px-1 text-sm font-semibold text-warning"
        >
          <Hammer className="size-3.5" />!
        </span>
      </Tooltip>
    );
  }

  if (fit.recommendedBuildings <= fit.capacityBuildings) return null;
  const content = `Suggested physical count: ${fit.recommendedBuildings}. The solver needs ${num(machine.count)} effective buildings (${fit.capacityBuildings} for capacity), but each ${footprint} building needs ${fit.usedSlots} of ${fit.accessSlots} perimeter positions at ${fit.recommendedBuildings} buildings (${reserved}) using ${moverName}. This checks adjacent access only; it does not prove belts or pipes can be routed.`;
  return (
    <Tooltip content={content}>
      <span
        aria-label={`Suggested build count ${fit.recommendedBuildings}`}
        className="inline-flex items-center gap-1 px-1 text-sm font-semibold text-warning tabular-nums"
      >
        <Hammer className="size-3.5" /> {fit.recommendedBuildings}
      </span>
    </Tooltip>
  );
}
