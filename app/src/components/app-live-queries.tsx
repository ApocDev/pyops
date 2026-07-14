import { useQuery } from "@tanstack/react-query";

import {
  bridgeStatusQuery,
  LIVE_QUERY_INTERVALS,
  logisticsContextQuery,
  researchHorizonQuery,
  undoStatusQuery,
} from "../lib/live-query-options";

/**
 * Single owner for the app-shell's recurring status reads. Desktop and mobile
 * navigation are both mounted (CSS decides which one is visible), so putting an
 * interval in each control creates duplicate timers for the same query. The
 * controls remain ordinary query-cache subscribers and mutations still
 * invalidate the same keys for immediate refreshes.
 */
export function AppLiveQueries() {
  useQuery({
    ...bridgeStatusQuery,
    refetchInterval: LIVE_QUERY_INTERVALS.bridge,
  });
  useQuery({
    ...researchHorizonQuery,
    refetchInterval: LIVE_QUERY_INTERVALS.horizon,
  });
  useQuery({
    ...logisticsContextQuery,
    refetchInterval: LIVE_QUERY_INTERVALS.logistics,
  });
  useQuery({
    ...undoStatusQuery,
    refetchInterval: LIVE_QUERY_INTERVALS.undo,
  });

  return null;
}
