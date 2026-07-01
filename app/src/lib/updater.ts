// Client for the desktop shell's self-updater. The updater logic lives in Rust
// (`app/src-tauri`: the `updater_check` / `updater_install` commands + a signature
// check); this module just calls them when we detect we're running inside the Tauri
// window. In a plain browser it's inert — except for a `?mockUpdate=` dev switch that
// fakes an update so the toast + dialog can be built and reviewed in `vp dev` without
// a bundled build.
//
// `@tauri-apps/api` is imported dynamically and only under `isTauri()`, so the browser
// build / web deploy never loads it.

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

/** Check once for a newer release. Returns metadata, or null when up to date / not in
 * the desktop shell / the check failed. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const mock = mockUpdate();
  if (mock) return mock;
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<UpdateInfo | null>("updater_check");
}

/** Download + install the pending update, reporting progress as a 0..1 fraction (or
 * null while the total size is unknown). In the real shell the app relaunches when
 * done, so this may never resolve; in mock mode it simulates a few seconds. */
export async function installUpdate(onProgress: (fraction: number | null) => void): Promise<void> {
  if (mockUpdate()) {
    for (let p = 0; p <= 1; p += 0.04) {
      onProgress(p);
      await new Promise((r) => setTimeout(r, 100));
    }
    onProgress(1);
    return;
  }
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  type Msg =
    | { event: "progress"; data: { chunkLength: number; contentLength: number | null } }
    | { event: "finished" };
  const channel = new Channel<Msg>();
  let downloaded = 0;
  let total = 0;
  channel.onmessage = (msg) => {
    if (msg.event === "progress") {
      if (msg.data.contentLength) total = msg.data.contentLength;
      downloaded += msg.data.chunkLength;
      onProgress(total ? Math.min(downloaded / total, 1) : null);
    } else if (msg.event === "finished") {
      onProgress(1);
    }
  };
  await invoke("updater_install", { onEvent: channel });
}
