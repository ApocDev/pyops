/** Shared view types for the block editor's render components: the solve result
 * shape (as the editor receives it from `solveBlockFn`) and the logistics
 * readout bundle threaded to every chip row (#21/#22). */
import type { computeBlock } from "../../server/block-compute.server.ts";
import type { ResolvedLogistics } from "../../lib/logistics";
import type { ResolvedRobots } from "../../lib/robots";

type ComputedBlockResult = Awaited<ReturnType<typeof computeBlock>>;
type CoreSolveResult = Omit<ComputedBlockResult, "recipes">;

/** The editor enriches authoritative core rows with lazy presentation-only
 * module hints. They are deliberately absent from `computeBlock` itself. */
export type SolveResult = Omit<CoreSolveResult, "rows"> & {
  rows: Array<CoreSolveResult["rows"][number] & { suggestedModules?: string[] }>;
};

/** Per-item logistics view config: the resolved belt/mover picks plus the
 * show toggles, and `launchInfo` for the opt-in rocket readout. Null `resolved`
 * = logistics display off. */
export type LogiView = {
  resolved: ResolvedLogistics | null;
  showBelts: boolean;
  showInserters: boolean;
  launchInfo: (name: string, rate: number) => { perMin: number; defaulted: boolean } | null;
  /** robot counts on the boundary chips (#255): the picks, and this block's
   * trip distance (its override, else the factory default). Null = off. */
  robots: { resolved: ResolvedRobots; distance: number } | null;
  /** the factory-wide trip distance, for the override strip */
  defaultRobotDistance: number;
};
