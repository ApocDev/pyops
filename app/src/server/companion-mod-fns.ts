/**
 * Server functions for the companion-mod installer — the client surface for
 * linking/copying mod/ into the Factorio mods folder. The node-only logic is
 * imported dynamically so fs/os never reach the client bundle (same pattern as
 * the bridge and db query layers).
 */
import { createServerFn } from "@tanstack/react-start";
import type { InstallMethod } from "./companion-mod.ts";

const mod = () => import("./companion-mod.ts");

export const companionStatusFn = createServerFn({ method: "GET" }).handler(async () =>
  (await mod()).companionStatus(),
);

export const installCompanionFn = createServerFn({ method: "POST" })
  .validator((d: { method: InstallMethod }) => d)
  .handler(async ({ data }) => (await mod()).installCompanion(data.method));

export const uninstallCompanionFn = createServerFn({ method: "POST" }).handler(async () =>
  (await mod()).uninstallCompanion(),
);
