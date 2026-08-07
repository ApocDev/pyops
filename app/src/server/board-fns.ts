/**
 * Server-fn wrapper for the factory board (client-importable by design: the
 * server-only module is referenced only inside `.handler()` bodies).
 */
import { createServerFn } from "@tanstack/react-start";

import {
  setBlockBoardPositions,
  setBlockFlowPositions,
  type BoardPosition,
  type FlowNodePositions,
} from "./factory-board.server.ts";

/** Save hand-placed board positions ({x,y} per block; nulls reset to auto). */
export const setBoardPositionsFn = createServerFn({ method: "POST" })
  .validator((d: { positions: BoardPosition[] }) => d)
  .handler(async ({ data }) => {
    setBlockBoardPositions(
      data.positions.map((p) => ({
        id: p.id,
        x: p.x == null || !Number.isFinite(p.x) ? null : Math.round(p.x),
        y: p.y == null || !Number.isFinite(p.y) ? null : Math.round(p.y),
      })),
    );
    return { ok: true };
  });

/** Save hand-placed Flow-view node positions for one block. `reset` clears them
 * back to auto-layout; `liveIds` prunes nodes the block no longer contains. */
export const setFlowPositionsFn = createServerFn({ method: "POST" })
  .validator(
    (d: { blockId: number; positions: FlowNodePositions; liveIds?: string[]; reset?: boolean }) =>
      d,
  )
  .handler(async ({ data }) => {
    const rounded: FlowNodePositions = {};
    for (const [id, p] of Object.entries(data.positions)) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        rounded[id] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
    }
    setBlockFlowPositions(data.blockId, rounded, {
      liveIds: data.liveIds,
      reset: data.reset,
    });
    return { ok: true };
  });
