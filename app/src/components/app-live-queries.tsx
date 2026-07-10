import { useQuery } from "@tanstack/react-query";

import { bridgeStatusFn } from "../server/bridge/fns";
import { logisticsContextFn, researchHorizonFn } from "../server/factorio";
import { undoStatusFn } from "../server/undo";

/**
 * Single owner for the app-shell's recurring status reads. Desktop and mobile
 * navigation are both mounted (CSS decides which one is visible), so putting an
 * interval in each control creates duplicate timers for the same query. The
 * controls remain ordinary query-cache subscribers and mutations still
 * invalidate the same keys for immediate refreshes.
 */
export function AppLiveQueries() {
  useQuery({
    queryKey: ["bridgeStatus"],
    queryFn: () => bridgeStatusFn(),
    refetchInterval: 2000,
  });
  useQuery({
    queryKey: ["researchHorizon"],
    queryFn: () => researchHorizonFn(),
    refetchInterval: 4000,
  });
  useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
    refetchInterval: 5000,
  });
  useQuery({
    queryKey: ["undoStatus"],
    queryFn: () => undoStatusFn(),
    refetchInterval: 5000,
  });

  return null;
}
