# Desktop app & releases

PyOps ships as a desktop app (a [Tauri](https://tauri.app) shell) in addition to
running as a plain web app. The shell wraps the **same** Nitro server — UI and
backend — in a native window; the React UI stays Tauri-agnostic, so anything
desktop-specific (external links, self-update) lives in the Rust shell, not the web
app. The shell is `app/src-tauri/` (`src/lib.rs` is the whole of it).

## How it runs

The window *is* the web app: it loads the local Nitro server.

- **Dev** — `beforeDevCommand` (in `tauri.conf.json`) starts the server on port
  34115; Tauri waits for it and the window loads it. Run with `vp run tauri dev`
  (or `cargo tauri dev`).
- **Bundled** — there is no `vp`/Node on the user's machine, so the Rust shell
  starts the server itself: it spawns a **vendored `node` sidecar** against the
  bundled `.output` server, with the data/migrations/mod paths resolved from the
  bundle and the OS. The window opens hidden and reveals on first paint (no white
  flash while the server boots).

`PORT` is fixed (34115), which is why only **one instance** runs at a time
(`tauri-plugin-single-instance`); a second launch just focuses the existing window.
Supporting multiple instances / multiple open projects is tracked in
[#41](https://github.com/ApocDev/pyops/issues/41).

## Where data lives

All on-disk state resolves through a single **data dir** (`app/src/server/paths.server.ts`):
project databases (`projects/`), the icon atlas (`icon-data/`), and `app-config.json`.

- **Dev** — the working directory (`app/`), so it shares your dev data.
- **Bundled** — the per-OS app-data dir (e.g. `~/.local/share/com.apocdev.pyops`),
  overridable with `PYOPS_DATA_DIR`. A fresh install starts **empty**; you run a data
  sync to populate it.

The resolved path is shown in **Settings → Game data → Storage location** (copy-able)
so it's findable for debugging or sharing a database.

## Building a bundle

```bash
cd app/src-tauri
./vendor-node.sh                    # fetch the node sidecar (gitignored, per-platform)
cd .. && vp run tauri build --bundles deb,appimage   # or dmg / nsis on mac / windows
```

- The vendored `node` is the runtime; `.output` (the server), `drizzle/`
  (migrations), and `../mod` are bundled as resources (see `tauri.conf.json`
  `bundle.resources` / `externalBin`).
- **Targets**: `deb` + `AppImage` (Linux), `dmg` (macOS), NSIS installer (Windows).
  The local default is `deb` only — AppImage's `linuxdeploy` tooling is unhappy on a
  non-Debian host, but it builds cleanly on the Ubuntu CI runner.
- **Linux**: the shell forces `GDK_BACKEND=x11` + `WEBKIT_DISABLE_DMABUF_RENDERER`
  to avoid a webkit2gtk Wayland "Error 71" crash. AppImages need FUSE; if missing,
  run with `--appimage-extract-and-run`.

### Plugins in the shell

`single-instance`, `window-state` (remembers size/position), `opener` (external
links open in the system browser), `updater` + `process` (the self-update flow), and
`shell` (the node sidecar).

## Releases

Releases are driven by **conventional commits** via
[release-please](https://github.com/googleapis/release-please) — `feat:` → minor,
`fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major.

1. Push conventional commits to `main`.
2. release-please opens/maintains a **release PR** that bumps the version — one
   version for the whole product, kept in lockstep across `version.txt`,
   `app/package.json`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`,
   and the mod's `mod/info.json` (**don't hand-edit these**) — and the changelog.
3. Merging the release PR creates the tag + GitHub release. An inline step then
   rewrites the GitHub release body with an LLM — a short friendly summary on top,
   the raw release-please changelog kept verbatim below a divider (see
   "Release-notes polish" below). The build matrix then builds, signs, and attaches
   each platform's bundles, and a final job aggregates a signed `latest.json` onto
   the release.

The matrix builds Linux (`deb` + `AppImage`), Windows (NSIS), and **both** macOS
arches — Apple Silicon natively and Intel **cross-compiled on the arm64 runner**
(`--target x86_64-apple-darwin`, with `vendor-node.sh TARGET_TRIPLE=…` fetching the
matching x64 Node sidecar), since GitHub's Intel `macos-13` runners are deprecated
and queue-starved. The tauri CLI is invoked directly (`tauri build`), not via
`tauri-action`, which assumes an npm/pnpm script runner rather than `vp`.

Config: `release-please-config.json` + `.release-please-manifest.json` — a single
package rooted at the repo (`.`), so all the version files above (across `app/` and
`mod/`) are reachable as plain `extra-files` paths, and the action emits unprefixed
outputs (`tag_name`, `releases_created`) that the build gate reads. Workflow:
`.github/workflows/release.yml` (release-please job + AI notes polish → gated build
matrix → `latest-json` aggregate job, all one workflow so no PAT is needed).
`workflow_dispatch` with a `tag` input rebuilds an existing release's assets
(recovery / fill-in) by building `main`; without a tag
it's a build-only smoke test.

**Release-notes polish**: right after release-please cuts the release, a step in
the same job asks an LLM (via OpenRouter — the **`OPENROUTER_API_KEY` repo
secret**; optional `RELEASE_NOTES_MODEL` repo *variable* to override the default
small model) to rewrite the release body into a short friendly summary, keeping
the raw changelog below a divider. It runs before the build/`latest-json` jobs,
so the in-app update dialog — which renders `latest.json`'s `notes` — shows the
same polished text as the releases page. The model only writes the summary; the
step assembles summary + divider + original body itself, so no changes can be
invented into or dropped from the changelog, and `CHANGELOG.md` stays the
deterministic commit-derived record. It **fails open**: a missing secret, an API
error, or an empty reply leaves release-please's raw notes untouched and the
workflow green — a release is never blocked on the polish.

## Self-update

The app updates itself from GitHub Releases.

- The release build signs the updater artifacts with the CI key
  (`createUpdaterArtifacts` emits a `.sig` per platform), and the `latest-json` job
  aggregates each platform's `{signature, url}` into one `latest.json` — listing each
  artifact's URL + signature, with the release body (the AI-polished notes, or the
  raw changelog if the polish was skipped) as `notes` — attached to the release.
  The updater artifact is picked explicitly per platform (AppImage / `.app.tar.gz` /
  `-setup.exe`), and the macOS `.app.tar.gz` is arch-suffixed so the two Mac builds
  don't collide.
- On launch the **web UI** checks `releases/latest/download/latest.json` via
  `@tauri-apps/plugin-updater`'s `check()`. If a newer version exists it pins a small
  toast bottom-right that opens a changelog dialog (rendered markdown, scrollable);
  **Install & Restart** calls the update's `downloadAndInstall()` (streaming progress,
  signature-verify against the baked-in public key) then `relaunch()` from
  `@tauri-apps/plugin-process`. The plugin JS is imported **lazily behind
  `window.isTauri`**, so the browser build never loads it and the web app stays
  Tauri-agnostic (a `?mockUpdate=` dev switch previews the toast + dialog in `vp dev`).
- **Why the built-in plugins, not custom commands:** the window loads the app over
  HTTP, so Tauri treats that content as *remote* and won't let it call a command
  without an explicit ACL grant. Custom app commands have no permission you can
  grant to remote content — but plugin commands do, so `capabilities/default.json`
  lists `updater:default` + `process:default` alongside the `remote.urls` rule for
  `http://localhost:*/**`. (Hand-rolled `invoke` commands were silently ACL-denied;
  this is the fix.)
- Self-update rides the **AppImage / NSIS / .app** artifacts — the `.deb` does not
  self-update (use the AppImage on Linux for updates).

**Signing key**: the public key lives in `tauri.conf.json` (`plugins.updater.pubkey`);
the private key + password are the `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets. The private key must be backed up —
if it's lost, existing installs can no longer verify updates and the key has to be
rotated (which changes the public key).

A **nightly / prerelease channel** (a second `latest.json` the app can opt into) is a
planned follow-on, not yet wired up.
