import { useQuery } from "@tanstack/react-query";
import { qualityLadderFn } from "../server/factorio";

/** One quality in chain order, with its localized name. */
export type QualityStep = { name: string; display: string };

/** The project's quality chain (#267): every quality from normal up, and the
 * best one the research horizon unlocks. `has` is false when the data has no
 * quality chain (every Py project), and every quality control hides then. */
export function useQualityLadder(): { ladder: QualityStep[]; top: string; has: boolean } {
  const { data } = useQuery({
    queryKey: ["qualityLadder"],
    queryFn: () => qualityLadderFn(),
    staleTime: 60_000,
  });
  const ladder = data?.ladder ?? [];
  return { ladder, top: data?.top ?? "normal", has: ladder.length > 1 };
}
