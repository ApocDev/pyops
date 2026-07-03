import { createServerFn } from "@tanstack/react-start";

/**
 * Server functions for the dependency explorer (#100). Server-only logic lives
 * in deps.server.ts and is referenced only inside `.handler()` bodies (the
 * client build swaps these for RPC stubs and prunes the import).
 */
import * as deps from "./deps.server.ts";

export type { DepsDir, DepsNode, DepsRootKind, DepsTree } from "./deps.server.ts";

export const depsSearchFn = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) => deps.depsSearch(data));

export const depsTreeFn = createServerFn({ method: "GET" })
  .validator(
    (d: {
      kind: "good" | "recipe";
      name: string;
      dir: "requires" | "requiredBy";
      depth: number;
    }) => ({
      kind: d.kind === "recipe" ? ("recipe" as const) : ("good" as const),
      name: String(d.name),
      dir: d.dir === "requiredBy" ? ("requiredBy" as const) : ("requires" as const),
      depth: Number(d.depth) || 4,
    }),
  )
  .handler(async ({ data }) => deps.depsTree(data));
