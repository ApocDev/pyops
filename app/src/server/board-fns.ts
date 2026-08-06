/**
 * Server-fn wrapper for the factory board (client-importable by design: the
 * server-only module is referenced only inside `.handler()` bodies).
 */
import { createServerFn } from "@tanstack/react-start";

import { setBlockBoardPositions, type BoardPosition } from "./factory-board.server.ts";

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
