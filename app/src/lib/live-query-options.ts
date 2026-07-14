import { queryOptions } from "@tanstack/react-query";

import { bridgeStatusFn } from "../server/bridge/fns";
import { logisticsContextFn, researchHorizonFn } from "../server/factorio";
import { undoStatusFn } from "../server/undo";

export const LIVE_QUERY_INTERVALS = {
  bridge: 2_000,
  horizon: 4_000,
  logistics: 5_000,
  undo: 5_000,
} as const;

/** App-shell status reads have several visible and responsive-layout subscribers.
 * Match their freshness to the single polling owner's cadence so mounting a
 * hidden desktop/mobile control does not refetch data that was just loaded. */
export const bridgeStatusQuery = queryOptions({
  queryKey: ["bridgeStatus"],
  queryFn: () => bridgeStatusFn(),
  staleTime: LIVE_QUERY_INTERVALS.bridge,
});

export const researchHorizonQuery = queryOptions({
  queryKey: ["researchHorizon"],
  queryFn: () => researchHorizonFn(),
  staleTime: LIVE_QUERY_INTERVALS.horizon,
});

export const logisticsContextQuery = queryOptions({
  queryKey: ["logisticsContext"],
  queryFn: () => logisticsContextFn(),
  staleTime: LIVE_QUERY_INTERVALS.logistics,
});

export const undoStatusQuery = queryOptions({
  queryKey: ["undoStatus"],
  queryFn: () => undoStatusFn(),
  staleTime: LIVE_QUERY_INTERVALS.undo,
});

/** Cache-only observers for controls below the root polling owner. Disabled
 * queries still receive cache updates and mutation invalidations, but cannot
 * start a duplicate request when responsive variants mount together. */
export const bridgeStatusSubscription = queryOptions({ ...bridgeStatusQuery, enabled: false });
export const researchHorizonSubscription = queryOptions({
  ...researchHorizonQuery,
  enabled: false,
});
export const logisticsContextSubscription = queryOptions({
  ...logisticsContextQuery,
  enabled: false,
});
export const undoStatusSubscription = queryOptions({ ...undoStatusQuery, enabled: false });
