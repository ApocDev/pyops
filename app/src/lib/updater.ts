// Client for the desktop shell's self-updater. It drives the standard
// tauri-plugin-updater + tauri-plugin-process via their JS APIs when we detect we're
// inside the Tauri window. In a plain browser it's inert — except for a `?mockUpdate=`
// dev switch that fakes an update so the toast + dialog can be built and reviewed in
// `vp dev` without a bundled build.
//
// The plugin JS is imported dynamically and only under `isTauri()`, so the browser
// build / web deploy never loads it — no hard Tauri dependency in the web runtime.

import type { Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ((window as unknown as { isTauri?: boolean }).isTauri === true ||
      "__TAURI_INTERNALS__" in window)
  );
}

const SHORT_NOTES = `## [0.2.1](https://github.com/ApocDev/pyops/compare/v0.2.0...v0.2.1) (2026-07-01)

### Features

* **app:** add a keyboard shortcut to jump between blocks ([abc1234](https://example.com))
* **planner:** remember the last-used machine per recipe ([def5678](https://example.com))

### Bug Fixes

* **solver:** keep a block solvable when a goal has no recipe ([6b294d1](https://example.com))
* **app:** stop the sidebar drawer closing on tab switch ([5f5ef8f](https://example.com)), closes [#37](https://example.com)`;

const LONG_NOTES = [
  "## [0.2.1](https://github.com/ApocDev/pyops/compare/v0.2.0...v0.2.1) (2026-07-01)",
  "",
  "### Features",
  "",
  ...Array.from(
    { length: 28 },
    (_, i) =>
      `* **app:** feature ${i + 1} that does a genuinely useful thing ([abc${i}](https://example.com))`,
  ),
  "",
  "### Bug Fixes",
  "",
  ...Array.from(
    { length: 22 },
    (_, i) => `* **solver:** fix ${i + 1} for a tricky edge case ([def${i}](https://example.com))`,
  ),
].join("\n");

/** Dev switch: `?mockUpdate=1` (short changelog) or `?mockUpdate=long` (a big one).
 * Dev builds only, so it's unreachable in a packaged app / web deploy. */
export function mockUpdate(): UpdateInfo | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const kind = new URLSearchParams(window.location.search).get("mockUpdate");
  if (!kind) return null;
  return {
    version: "0.2.1",
    currentVersion: "0.2.0",
    notes: kind === "long" ? LONG_NOTES : SHORT_NOTES,
    date: "2026-07-01T00:00:00Z",
  };
}

// The pending Update from the last check, so installUpdate can download + install it.
let pending: Update | null = null;

/** Check once for a newer release. Returns metadata, or null when up to date / not in
 * the desktop shell / the check failed. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const mock = mockUpdate();
  if (mock) return mock;
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  pending = update;
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
  };
}

/** Download + install the pending update, reporting progress as a 0..1 fraction (or
 * null while the total size is unknown), then relaunch. In the real shell the app
 * relaunches when done; in mock mode it simulates a few seconds. */
export async function installUpdate(onProgress: (fraction: number | null) => void): Promise<void> {
  if (mockUpdate()) {
    for (let p = 0; p <= 1; p += 0.04) {
      onProgress(p);
      await new Promise((r) => setTimeout(r, 100));
    }
    onProgress(1);
    return;
  }
  if (!pending) throw new Error("no pending update");
  let downloaded = 0;
  let total = 0;
  await pending.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress(total ? Math.min(downloaded / total, 1) : null);
        break;
      case "Finished":
        onProgress(1);
        break;
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
