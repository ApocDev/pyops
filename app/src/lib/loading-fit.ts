import { rowLogistics, type ResolvedLogistics } from "./logistics.ts";

export type LoadingStream = {
  name: string;
  kind: string;
  rate: number;
  direction: "input" | "output";
};

export type LoadingFuel = {
  name: string;
  kind: string;
  rate: number;
  burnt?: { name: string; rate: number } | null;
} | null;

export type LoadingFit = {
  capacityBuildings: number;
  recommendedBuildings: number | null;
  width: number;
  height: number;
  accessSlots: number;
  usedSlots: number;
  itemSlots: number;
  fluidSlots: number;
  itemStreams: number;
  fluidStreams: number;
  deviceKind: "inserter" | "loader";
};

const EPS = 1e-9;

/**
 * Conservative adjacent-access fit for one recipe row.
 *
 * This deliberately does not alter solver capacity. It asks how many whole
 * buildings are needed when every non-zero item stream gets whole selected
 * movers on every running machine, active fluid streams reserve pipe access,
 * and solid/fluid fuel plus burnt results reserve their own access. It proves
 * only that enough perimeter positions exist; belt/pipe routing, beacons,
 * direct insertion, and shared circuit-controlled movers remain layout work.
 */
export function loadingFit(args: {
  logistics: ResolvedLogistics;
  machineCount: number;
  tileWidth: number | null;
  tileHeight: number | null;
  ingredients: LoadingStream[];
  products: LoadingStream[];
  fuel: LoadingFuel;
}): LoadingFit | null {
  const { logistics, machineCount } = args;
  const width = args.tileWidth;
  const height = args.tileHeight;
  if (!(machineCount > EPS) || !width || !height || width < 1 || height < 1) return null;

  // Combine duplicate recipe/fuel streams only when they travel in the same
  // direction. An item that is both consumed and produced needs both sides.
  const itemRates = new Map<
    string,
    { name: string; direction: "input" | "output"; rate: number }
  >();
  const fluidKeys = new Set<string>();
  const add = (stream: LoadingStream) => {
    if (!(stream.rate > EPS)) return;
    const key = `${stream.direction}:${stream.name}`;
    if (stream.kind === "item") {
      const current = itemRates.get(key);
      itemRates.set(key, {
        name: stream.name,
        direction: stream.direction,
        rate: (current?.rate ?? 0) + stream.rate,
      });
    } else if (stream.kind === "fluid") {
      fluidKeys.add(key);
    }
  };
  for (const stream of [...args.ingredients, ...args.products]) add(stream);
  if (args.fuel && args.fuel.rate > EPS) {
    add({
      name: args.fuel.name,
      kind: args.fuel.kind,
      rate: args.fuel.rate,
      direction: "input",
    });
    if (args.fuel.burnt && args.fuel.burnt.rate > EPS) {
      add({
        name: args.fuel.burnt.name,
        kind: "item",
        rate: args.fuel.burnt.rate,
        direction: "output",
      });
    }
  }

  const itemStreams = [...itemRates.values()];
  const fluidSlots = fluidKeys.size;
  const accessSlots = 2 * (width + height);
  const baselineSlots = itemStreams.length + fluidSlots;
  const capacityBuildings = Math.max(1, Math.ceil(machineCount - EPS));
  const base = {
    capacityBuildings,
    width,
    height,
    accessSlots,
    fluidSlots,
    itemStreams: itemStreams.length,
    fluidStreams: fluidKeys.size,
    deviceKind: logistics.moverKind,
  };

  // Even infinitely many buildings cannot help when every machine's one access
  // per stream already exceeds its perimeter.
  if (baselineSlots > accessSlots) {
    return {
      ...base,
      recommendedBuildings: null,
      usedSlots: baselineSlots,
      itemSlots: itemStreams.length,
    };
  }

  const slotsAt = (buildings: number) => {
    let itemSlots = 0;
    for (const stream of itemStreams) {
      const row = rowLogistics(logistics, stream.rate, buildings);
      if (!row || !Number.isFinite(row.devices)) return null;
      itemSlots += Math.max(1, Math.ceil(row.devices - EPS));
    }
    return { itemSlots, usedSlots: itemSlots + fluidSlots };
  };

  const initial = slotsAt(capacityBuildings);
  if (!initial) return null;
  if (initial.usedSlots <= accessSlots) {
    return {
      ...base,
      recommendedBuildings: capacityBuildings,
      ...initial,
    };
  }

  // At max(total-flow movers for any one stream), every stream is down to one
  // mover per building. That is a guaranteed fitting upper bound because the
  // baseline check above already passed.
  let high = capacityBuildings;
  for (const stream of itemStreams) {
    const wholeFlow = rowLogistics(logistics, stream.rate, 1);
    if (!wholeFlow || !Number.isFinite(wholeFlow.devices)) return null;
    high = Math.max(high, Math.ceil(wholeFlow.devices - EPS));
  }
  high = Math.max(high, capacityBuildings + 1);

  // Required access is monotone as flow is divided over more buildings, so find
  // the first fitting whole count without walking large factory rates one by one.
  let low = capacityBuildings + 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const fit = slotsAt(mid);
    if (!fit) return null;
    if (fit.usedSlots <= accessSlots) high = mid;
    else low = mid + 1;
  }
  const recommended = slotsAt(low);
  if (!recommended) return null;
  return {
    ...base,
    recommendedBuildings: low,
    ...recommended,
  };
}
