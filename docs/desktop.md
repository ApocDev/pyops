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

All on-disk state resolves through a single **data dir** (`app/src/server/paths.ts`):
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
links open in the system browser), `dialog` (the update prompt), `updater`, and
`shell` (the node sidecar).

## Releases

Releases are driven by **conventional commits** via
[release-please](https://github.com/googleapis/release-please) — `feat:` → minor,
`fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major.

1. Push conventional commits to `main`.
2. release-please opens/maintains a **release PR** that bumps the version (kept in
   lockstep across `app/package.json`, `app/src-tauri/Cargo.toml`, and
   `tauri.conf.json` — **don't hand-edit these**) and updates the changelog.
3. Merging the release PR creates the tag + GitHub release; the build matrix then
   attaches the bundles + `latest.json` to it.

Config: `release-please-config.json` + `.release-please-manifest.json`; workflow:
`.github/workflows/release.yml` (release-please job → gated build job, same workflow
so no PAT is needed). `workflow_dispatch` runs a build-only smoke test.

## Self-update

The app updates itself from GitHub Releases.

- The release build (via `tauri-action`, with the signing key from CI secrets)
  produces **signed** updater artifacts and an aggregated `latest.json` listing each
  platform's artifact URL + signature + the changelog (`notes`).
- On launch, a bundled app checks `releases/latest/download/latest.json`; if a newer
  version exists it shows a native **"Update available"** dialog with the version and
  changelog, and **Install & Restart** downloads, verifies the signature against the
  baked-in public key, installs, and relaunches. All Rust-side (`check_for_update` in
  `lib.rs`); dev builds skip it.
- Self-update rides the **AppImage / NSIS / .app** artifacts — the `.deb` does not
  self-update (use the AppImage on Linux for updates).

**Signing key**: the public key lives in `tauri.conf.json` (`plugins.updater.pubkey`);
the private key + password are the `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets. The private key must be backed up —
if it's lost, existing installs can no longer verify updates and the key has to be
rotated (which changes the public key).

A **nightly / prerelease channel** (a second `latest.json` the app can opt into) is a
planned follow-on, not yet wired up.
