import { createServerFn } from "@tanstack/react-start";
import * as q from "../db/queries.server.ts";
import { computeBlock, persistBlock, type SolveInput } from "./block-compute.server.ts";
import { withUndoAction } from "./undo-action.server.ts";

/** Create an untouched block directly in a sidebar folder. Creation and folder
 * assignment share one undo action so one user gesture never takes two undos. */
export const createBlockInGroupFn = createServerFn({ method: "POST" })
  .validator((groupId: number) => groupId)
  .handler(async ({ data: groupId }) => {
    const doc: SolveInput = { goals: [], recipes: [] };
    const solve = await computeBlock(doc);
    const id = await withUndoAction('Create block "New block"', async () => {
      const blockId = await persistBlock(
        { name: "New block", iconKind: "item", iconName: "" },
        doc,
        solve,
      );
      q.setBlockGroup(blockId, groupId);
      return blockId;
    });
    return { id };
  });
