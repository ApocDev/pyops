/** Shared view types for the block editor's render components: the solve result
 * shape (as the editor receives it from `solveBlockFn`) and the logistics
 * readout bundle threaded to every chip row (#21/#22). */
import type { computeBlock } from "../../server/block-compute.server.ts";
import type { ResolvedLogistics } from "../../lib/logistics";
import type { ResolvedRobots, RobotProto } from "../../lib/robots";

/** Robots for one solved boundary flow (#255): the fractional count, the robot
 * it is sized for, and the trip distance used. */
export type RobotCount = { count: number; robot: RobotProto; distance: number };

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
  /** robot picks and this block's trip distance (its override, else the
   * factory default) (#255). Null = robots off. */
  robots: { resolved: ResolvedRobots; distance: number } | null;
  /** robots for one SOLVED boundary flow; null when robots are off, the good
   * isn't an item robots carry, or stack sizes haven't loaded yet */
  robotsFor: (flow: { name: string; kind: string; rate: number }) => RobotCount | null;
  /** the factory-wide trip distance, for the override strip */
  defaultRobotDistance: number;
};
