/**
 * Server functions for the companion-mod installer — the client surface for
 * linking/copying mod/ into the Factorio mods folder. The node-only module is
 * referenced only inside `.handler()` bodies, so the Start compiler prunes it
 * (and fs/os) from the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import type { InstallMethod } from "./companion-mod.server.ts";

import * as mod from "./companion-mod.server.ts";

export const companionStatusFn = createServerFn({ method: "GET" }).handler(async () =>
  mod.companionStatus(),
);

export const installCompanionFn = createServerFn({ method: "POST" })
  .validator((d: { method: InstallMethod }) => d)
  .handler(async ({ data }) => mod.installCompanion(data.method));

export const uninstallCompanionFn = createServerFn({ method: "POST" }).handler(async () =>
  mod.uninstallCompanion(),
);
