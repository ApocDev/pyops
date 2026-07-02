/** Shared view types for the block editor's render components: the solve result
 * shape (as the editor receives it from `solveBlockFn`) and the logistics
 * readout bundle threaded to every chip row (#21/#22). */
import type { computeBlock } from "../../server/block-compute.server.ts";
import type { ResolvedLogistics } from "../../lib/logistics";

export type SolveResult = Awaited<ReturnType<typeof computeBlock>>;

/** Per-item logistics view config: the resolved belt/mover picks plus the
 * show toggles, and `launchInfo` for the opt-in rocket readout. Null `resolved`
 * = logistics display off. */
export type LogiView = {
  resolved: ResolvedLogistics | null;
  showBelts: boolean;
  showInserters: boolean;
  launchInfo: (name: string, rate: number) => { perMin: number; defaulted: boolean } | null;
};
