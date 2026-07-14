import { createServerFn } from "@tanstack/react-start";
import * as q from "../db/queries.server.ts";
import { ensureSolvedProjections } from "./block-compute.server.ts";

/** Batch factory-supply status for one block's visible imports. */
export const producedImportsFn = createServerFn({ method: "POST" })
  .validator((data: { blockId: number; goods: string[] }) => data)
  .handler(async ({ data }) => {
    await ensureSolvedProjections();
    return q.producedGoodsOutsideBlock(data.goods, data.blockId);
  });
