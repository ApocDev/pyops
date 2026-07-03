/**
 * Server functions for block/plan JSON export + import (#82). The db-touching
 * logic lives in export.server.ts and is referenced only inside `.handler()`
 * bodies, so the Start compiler prunes it from the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import * as ex from "./export.server.ts";

/** One block as a shareable, versioned JSON envelope. */
export const exportBlockFn = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .handler(async ({ data }) => ex.buildBlockExport(data));

/** The whole plan (all blocks + folders), or one folder's subtree via groupId. */
export const exportPlanFn = createServerFn({ method: "GET" })
  .validator((d: { groupId?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => ex.buildPlanExport(data.groupId));

/** Import a block/plan envelope: new blocks (fresh ids, suffixed names), new
 * folders, missing recipes/goods flagged per block. Throws on an unreadable file. */
export const importEnvelopeFn = createServerFn({ method: "POST" })
  .validator((d: { envelope: unknown }) => d)
  .handler(async ({ data }) => ex.importEnvelope(data.envelope));
