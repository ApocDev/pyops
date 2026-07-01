/**
 * Launch Factorio with the bridge flag already set, so the user never has to hand-
 * configure `--enable-lua-udp` (and never trips the same-port collision that
 * silently kills the bridge). Node-only — imported dynamically from the server fn
 * so `node:child_process` / `node:dgram` never reach the client bundle.
 *
 * The `--enable-lua-udp` port is the socket Factorio binds for *itself*, so it must
 * differ from the app's bridge port; we probe for a free port next to it.
 *
 * Steam vs. direct: a Steam copy launched directly (even with `SteamAppId` set, as
 * the data-dump does) does NOT get the Steam client's cloud-save / overlay /
 * achievement orchestration. So for a Steam copy we hand off to the client first
 * (`steam -applaunch`), and only fall back to a direct launch if that doesn't take
 * (Steam not on PATH / not running). A standalone copy just launches directly.
 */
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { FACTORIO_BIN, factorioRunning } from "./dump.ts";

const STEAM_APP_ID = "427520";

export type LaunchInfo = {
  binPath: string;
  isSteam: boolean;
  running: boolean | null;
};

export type LaunchResult = {
  ok: boolean;
  via: "direct" | "steam";
  isSteam: boolean;
  port: number;
  error?: string;
};

function isSteamInstall(): boolean {
  return /steamapps[/\\]/i.test(FACTORIO_BIN);
}

/** State the launch button needs: where the binary is, whether it's a Steam copy,
 * and whether a game is already running (button disabled in that case). */
export async function factorioLaunchInfo(): Promise<LaunchInfo> {
  return {
    binPath: FACTORIO_BIN,
    isSteam: isSteamInstall(),
    running: await factorioRunning(),
  };
}

/** Find a free localhost UDP port for Factorio's own socket, starting just above
 * the app's bridge port (the two can't share one). Falls back to appPort+1 if the
 * probe range is somehow all taken — the launch still proceeds. */
async function freeUdpPort(appPort: number): Promise<number> {
  for (let p = appPort + 1; p <= Math.min(appPort + 20, 65535); p++) {
    const free = await new Promise<boolean>((resolve) => {
      const s = dgram.createSocket("udp4");
      s.once("error", () => {
        try {
          s.close();
        } catch {
          /* already closed */
        }
        resolve(false);
      });
      s.bind(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (free) return p;
  }
  return appPort + 1;
}

/** Spawn a command detached and treat "still alive after a beat" as success — an
 * immediate spawn error or early exit resolves `ok: false` so the caller can try a
 * fallback. */
function spawnDetached(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child;
    try {
      child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch (e) {
      done({ ok: false, error: (e as Error).message });
      return;
    }
    child.on("error", (e) => done({ ok: false, error: e.message }));
    child.on("exit", (code) => done({ ok: false, error: `exited early (code ${code})` }));
    setTimeout(() => {
      if (!settled) {
        child.unref();
        done({ ok: true });
      }
    }, 1500);
  });
}

/** Hand off to the Steam client (`steam -applaunch …`). Unlike the game binary, the
 * `steam` CLI dispatches to the running client and exits ~immediately, so "stays
 * alive" is the wrong signal — success is "spawned without error and didn't exit
 * non-zero". A spawn error (Steam not on PATH) or a non-zero exit means fall back. */
function spawnSteamHandoff(args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child;
    try {
      child = spawn("steam", args, { detached: true, stdio: "ignore" });
    } catch (e) {
      done({ ok: false, error: (e as Error).message });
      return;
    }
    child.on("error", (e) => done({ ok: false, error: e.message })); // ENOENT: no steam
    child.on("exit", (code) =>
      done(code === 0 ? { ok: true } : { ok: false, error: `steam exited ${code}` }),
    );
    setTimeout(() => {
      if (!settled) {
        child.unref();
        done({ ok: true });
      }
    }, 1200);
  });
}

/** Launch Factorio with `--enable-lua-udp <freePort>`. For a Steam copy, hand off to
 * the Steam client first (so cloud saves / overlay / achievements work) and only
 * fall back to a direct launch if Steam isn't reachable. A standalone copy launches
 * directly. */
export async function launchFactorio(appPort: number): Promise<LaunchResult> {
  const isSteam = isSteamInstall();
  if (await factorioRunning()) {
    return { ok: false, via: "steam", isSteam, port: 0, error: "Factorio is already running." };
  }

  const port = await freeUdpPort(appPort);
  const args = ["--enable-lua-udp", String(port)];

  if (isSteam) {
    const viaSteam = await spawnSteamHandoff(["-applaunch", STEAM_APP_ID, ...args]);
    if (viaSteam.ok) return { ok: true, via: "steam", isSteam, port };

    // Steam not on PATH / not running — fall back to a direct launch so the button
    // still works (with SteamAppId set, as the data-dump does).
    const direct = await spawnDetached(FACTORIO_BIN, args, {
      SteamAppId: STEAM_APP_ID,
      SteamGameId: STEAM_APP_ID,
    });
    if (direct.ok) return { ok: true, via: "direct", isSteam, port };
    return { ok: false, via: "direct", isSteam, port, error: direct.error ?? viaSteam.error };
  }

  const direct = await spawnDetached(FACTORIO_BIN, args);
  if (direct.ok) return { ok: true, via: "direct", isSteam, port };
  return { ok: false, via: "direct", isSteam, port, error: direct.error };
}
