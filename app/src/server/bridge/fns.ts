/**
 * Server functions for the UDP bridge — the only bridge surface the client
 * touches. The dgram server is referenced only inside `.handler()` bodies, so
 * the Start compiler prunes it (and node:dgram) from the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import * as b from "./server.ts";
import { requestFromMod } from "./inspect.ts";
import { factorioLaunchInfo, launchFactorio } from "../factorio-launch.server.ts";

/** Ensure the bridge is listening and return its status. Calling this from the
 * UI (polled) is what starts the socket — idempotent and HMR-safe. */
export const bridgeStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  b.ensureBridge();
  return b.bridgeStatus();
});

/** Ask the connected mod to push its current state now (research, …). Returns
 * whether a peer was reachable. */
export const bridgeRequestSyncFn = createServerFn({ method: "POST" }).handler(async () => {
  b.ensureBridge();
  return { sent: b.sendToPeer({ type: "request.sync" }) };
});

/** Ask the connected game to locate a good in the world — the mod relays to the
 * Factory Search mod (producers / storage / consumers, zoomable). Fire-and-forget;
 * returns whether a peer was reachable. */
export const bridgeLocateFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; kind: "item" | "fluid" }) => d)
  .handler(async ({ data }) => {
    b.ensureBridge();
    return {
      sent: b.sendToPeer({ type: "cmd.locate", payload: { name: data.name, kind: data.kind } }),
    };
  });

/** Run a user-APPROVED Lua snippet in the game (#15) — the apply half of the
 * assistant's gameEval propose-then-approve gate. Only the chat card's Run
 * button calls this; the agent tool itself never executes. The mod refuses when
 * its `pyops-allow-eval` setting is off (defense in depth). */
export const bridgeEvalFn = createServerFn({ method: "POST" })
  .validator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    try {
      const r = await requestFromMod("cmd.eval", { code: data.code }, 8000);
      return r as { ok: boolean; result?: string; error?: string };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "bridge error" };
    }
  });

/** State for the "Launch Factorio" button: binary path, Steam-vs-standalone, and
 * whether a game is already running. */
export const factorioLaunchInfoFn = createServerFn({ method: "GET" }).handler(async () => {
  return factorioLaunchInfo();
});

/** Launch Factorio with `--enable-lua-udp` on a free port distinct from the app's
 * bridge port, so the bridge connects with no manual flag wrangling. */
export const launchFactorioFn = createServerFn({ method: "POST" }).handler(async () => {
  b.ensureBridge();
  return launchFactorio(b.bridgeStatus().port);
});
