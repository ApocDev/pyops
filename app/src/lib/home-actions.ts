const EPS = 1e-6;
export const LIVE_STATS_FRESH_MS = 30_000;

export type HomeDeficitState = "actionable" | "waiting" | "external";

export type HomeDeficit = {
  item: string;
  display: string;
  kind: string;
  produced: number;
  consumed: number;
  net: number;
  pctMet: number;
  state: HomeDeficitState;
};

type FactoryTotalRow = {
  item: string;
  display: string | null;
  kind: string;
  role: string;
  rate: number;
};

export function factoryDeficits(
  totals: FactoryTotalRow[],
  availability: { item: string; state: HomeDeficitState }[],
): HomeDeficit[] {
  const states = new Map(availability.map((row) => [row.item, row.state]));
  const byGood = new Map<
    string,
    { display: string; produced: number; consumed: number; kind: string }
  >();
  for (const flow of totals) {
    const row = byGood.get(flow.item) ?? {
      display: flow.display ?? flow.item,
      produced: 0,
      consumed: 0,
      kind: flow.kind,
    };
    if (flow.role === "import") row.consumed += flow.rate;
    else row.produced += flow.rate;
    byGood.set(flow.item, row);
  }
  return [...byGood.entries()]
    .map(([item, row]) => ({
      item,
      ...row,
      net: row.produced - row.consumed,
      pctMet: row.consumed > EPS ? row.produced / row.consumed : 1,
      state: states.get(item) ?? ("external" as const),
    }))
    .filter(
      (row) =>
        row.net < 0 &&
        Math.abs(row.net) > Math.max(EPS, 1e-2 * Math.max(row.produced, row.consumed)),
    )
    .sort((a, b) => a.pctMet - b.pctMet || a.net - b.net);
}

export type HomeProductionRow = {
  item: string;
  display: string | null;
  plannedProduced: number;
  plannedConsumed: number;
  actualProduced: number | null;
  actualConsumed: number | null;
};

export type LiveDrain = {
  item: string;
  display: string;
  produced: number;
  consumed: number;
  pctMet: number;
};

export function liveDrains(
  rows: HomeProductionRow[],
  syncedAt: string | null,
  now = Date.now(),
): LiveDrain[] {
  const syncedMs = syncedAt ? new Date(syncedAt).getTime() : Number.NaN;
  if (!Number.isFinite(syncedMs) || now - syncedMs > LIVE_STATS_FRESH_MS) return [];
  return rows
    .filter((row) => row.plannedProduced > EPS || row.plannedConsumed > EPS)
    .flatMap((row) => {
      const produced = row.actualProduced;
      const consumed = row.actualConsumed;
      if (produced == null || consumed == null || consumed <= EPS) return [];
      const gap = consumed - produced;
      if (gap <= Math.max(EPS, 1e-2 * Math.max(produced, consumed))) return [];
      return [
        {
          item: row.item,
          display: row.display ?? row.item,
          produced,
          consumed,
          pctMet: produced / consumed,
        },
      ];
    })
    .sort((a, b) => a.pctMet - b.pctMet || b.consumed - b.produced - (a.consumed - a.produced));
}

export type HomeBuildStatus = {
  blockId: number;
  block: string;
  phase: "unbuilt" | "partial" | "scale" | "scaled";
  requiredSteps: number;
  coveredSteps: number;
  requiredMachines: number;
  missingMachines: number;
};

export type HomeUnhealthyBlock = {
  id: number;
  name: string;
  health: "error" | "warn";
};

export type HomeAction =
  | { kind: "resync" }
  | { kind: "drain"; drain: LiveDrain }
  | { kind: "unbuilt"; build: HomeBuildStatus }
  | { kind: "partial"; build: HomeBuildStatus }
  | { kind: "plan"; deficit: HomeDeficit }
  | { kind: "scale"; build: HomeBuildStatus }
  | { kind: "unhealthy"; block: HomeUnhealthyBlock }
  | { kind: "caught-up" };

export type HomeActionInput = {
  needsRedump: boolean;
  drains: LiveDrain[];
  builds: HomeBuildStatus[];
  deficits: HomeDeficit[];
  unhealthy: HomeUnhealthyBlock[];
  dismissed?: Iterable<string>;
};

const planSignature = (deficit: HomeDeficit) =>
  `${deficit.produced.toPrecision(6)}:${deficit.consumed.toPrecision(6)}`;

export function homeActionKey(action: HomeAction): string | null {
  if (action.kind === "drain") return `drain:${action.drain.item}`;
  if (action.kind === "unbuilt" || action.kind === "partial" || action.kind === "scale")
    return `${action.kind}:${action.build.blockId}`;
  if (action.kind === "plan") return `plan:${action.deficit.item}:${planSignature(action.deficit)}`;
  if (action.kind === "unhealthy") return `unhealthy:${action.block.id}:${action.block.health}`;
  return null;
}

export function activeHomeActionKeys(input: HomeActionInput): string[] {
  return [
    ...input.drains.map((drain) => homeActionKey({ kind: "drain", drain })),
    ...input.builds.flatMap((build) =>
      build.phase === "scaled" ? [] : [homeActionKey({ kind: build.phase, build })],
    ),
    ...input.deficits
      .filter((deficit) => deficit.state === "actionable")
      .map((deficit) => homeActionKey({ kind: "plan", deficit })),
    ...input.unhealthy.map((block) => homeActionKey({ kind: "unhealthy", block })),
  ].filter((key): key is string => key != null);
}

export function chooseHomeAction(input: HomeActionInput): HomeAction {
  const dismissed = new Set(input.dismissed ?? []);
  if (input.needsRedump) return { kind: "resync" };
  const drain = input.drains.find(
    (row) => !dismissed.has(homeActionKey({ kind: "drain", drain: row })!),
  );
  if (drain) return { kind: "drain", drain };

  const unbuilt = input.builds.find(
    (build) =>
      build.phase === "unbuilt" && !dismissed.has(homeActionKey({ kind: "unbuilt", build })!),
  );
  if (unbuilt) return { kind: "unbuilt", build: unbuilt };
  const partial = input.builds
    .filter(
      (build) =>
        build.phase === "partial" && !dismissed.has(homeActionKey({ kind: "partial", build })!),
    )
    .sort(
      (a, b) =>
        a.coveredSteps / a.requiredSteps - b.coveredSteps / b.requiredSteps ||
        b.requiredSteps - b.coveredSteps - (a.requiredSteps - a.coveredSteps),
    )[0];
  if (partial) return { kind: "partial", build: partial };

  const deficit = input.deficits.find(
    (row) =>
      row.state === "actionable" && !dismissed.has(homeActionKey({ kind: "plan", deficit: row })!),
  );
  if (deficit) return { kind: "plan", deficit };
  const scale = input.builds
    .filter(
      (build) =>
        build.phase === "scale" && !dismissed.has(homeActionKey({ kind: "scale", build })!),
    )
    .sort(
      (a, b) => b.missingMachines / b.requiredMachines - a.missingMachines / a.requiredMachines,
    )[0];
  if (scale) return { kind: "scale", build: scale };
  const unhealthy = input.unhealthy.find(
    (block) => !dismissed.has(homeActionKey({ kind: "unhealthy", block })!),
  );
  if (unhealthy) return { kind: "unhealthy", block: unhealthy };
  return { kind: "caught-up" };
}
