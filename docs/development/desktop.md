---
title: Desktop app and releases
description: Understand the PyOps-specific Tauri shell, Node sidecar, resource wiring, release matrix, and updater manifest.
outline: [2, 3]
---

# Desktop app and releases

PyOps uses Tauri 2 to package the local application for Linux, macOS, and Windows. This page
documents the decisions specific to PyOps. Use Tauri's official documentation for the
framework mechanics:

- [configuration reference](https://v2.tauri.app/reference/config/);
- [embedding external binaries](https://v2.tauri.app/develop/sidecar/);
- [capabilities and remote API access](https://v2.tauri.app/security/capabilities/);
- [single-instance plugin](https://v2.tauri.app/plugin/single-instance/);
- [updater plugin](https://v2.tauri.app/plugin/updater/);
- [platform distribution and signing](https://v2.tauri.app/distribute/).

The shell lives under `app/src-tauri/`. `src/lib.rs` owns runtime setup;
`tauri.conf.json` owns bundle inputs and updater configuration;
`capabilities/default.json` owns webview permissions.

## PyOps runtime shape

PyOps does not package a static frontend with a separate remote backend. The application is
the TanStack Start/Nitro server, and the Tauri window loads it from
`http://localhost:34115`.

### Vendored Node sidecar

Installed users do not need Node. `vendor-node.sh` downloads the runtime expected by
Tauri's `externalBin` configuration. The bundle also carries:

- the Nitro `.output` directory;
- Drizzle migrations;
- the Companion mod source.

In a packaged build, Rust starts the Node sidecar with the bundled server entry and explicit
paths:

```text
HOST=127.0.0.1
PORT=34115
PYOPS_DATA_DIR=<Tauri app-data directory>
PYOPS_MIGRATIONS_DIR=<bundled drizzle directory>
PYOPS_MOD_DIR=<bundled mod directory>
```

The shell drains the child-process output channel and retains its handle so shutdown can
terminate the server cleanly.

This split is why server path code must use `app/src/server/paths.server.ts`. The current
working directory is not a reliable resource or data root in a packaged application.

### Fixed port and single instance

The webview URL uses fixed port `34115`. `tauri-plugin-single-instance` is registered before
setup so a second launch focuses the existing window and exits before it can start another
server on that port.

Supporting concurrent desktop processes would therefore require both instance-policy and
port-allocation changes; it is not only a window-management change.

### Delayed window reveal

The shell waits for the server port on a background thread, creates the main window hidden,
and reveals it after page load. This avoids showing an empty native webview while Nitro
starts.

`tauri-plugin-window-state` restores the user's previous geometry. External HTTP links are
intercepted and opened with `tauri-plugin-opener`; only localhost navigation remains inside
the PyOps window.

### Remote webview capabilities

Because the window loads `http://localhost:34115`, Tauri treats its content as a remote URL.
The default capability explicitly grants that localhost origin access to the updater and
process plugins.

This is the important PyOps-specific capability detail: adding a desktop plugin is not
enough. Any client call from the local HTTP application also needs an appropriately scoped
remote permission in `capabilities/default.json`.

Keep that allowlist limited to localhost and only the commands the application invokes.

### Linux WebKit workaround

Before GTK initializes, the shell supplies these values only when the user has not already
set them:

```text
GDK_BACKEND=x11
WEBKIT_DISABLE_DMABUF_RENDERER=1
```

They select the stable XWayland and non-DMABUF path for the WebKit versions targeted by the
Linux bundle. Do not move them into a child-process environment; they must affect the native
webview process.

## Data and resources

Writable projects, generated icons, and app configuration live under Tauri's app-data
directory for `com.apocdev.pyops`. Bundled migrations and mod files are read-only resources.

The shell passes those roots to the Node server rather than copying resources into the data
directory. The exact writable location is shown in **Settings → Game data → Storage
location**.

See [Settings and storage](../reference/settings-and-storage) for the user-facing boundary
and [Development configuration](./configuration) for source/deployment overrides.

## Local build commands

Run desktop development from `app/`:

```sh
vp run tauri dev
```

Vendor Node before creating a native bundle:

```sh
cd app/src-tauri
./vendor-node.sh
cd ..
vp run tauri build
```

Use `TARGET_TRIPLE` when the artifact architecture differs from the build host:

```sh
TARGET_TRIPLE=x86_64-apple-darwin ./vendor-node.sh
```

The sidecar architecture must match the Tauri target. Tauri expects the downloaded binary
under its target-triple-suffixed `externalBin` name.

The repository's local bundle default is `.deb`. Pass `--bundles` when testing another
format; the release workflow supplies its platform-specific lists.

## Version ownership

PyOps has one product version across the app, shell, and Factorio mod. Release Please keeps
these files in lockstep:

- `version.txt`;
- `app/package.json`;
- `app/src-tauri/tauri.conf.json`;
- `app/src-tauri/Cargo.toml`;
- `mod/info.json`.

Do not hand-edit only one version. Conventional commits determine the release, and the
generated release PR updates the complete set plus `CHANGELOG.md`.

## Release workflow quirks

`.github/workflows/release.yml` combines Release Please, artifact builds, and updater
manifest generation so they share one tag and finalized release body.

### Platform matrix

The matrix produces:

| Target           | Install artifact    | Updater artifact  |
| ---------------- | ------------------- | ----------------- |
| `linux-x86_64`   | `.deb`, `.AppImage` | `.AppImage`       |
| `darwin-aarch64` | `.dmg`              | `.app.tar.gz`     |
| `darwin-x86_64`  | `.dmg`              | `.app.tar.gz`     |
| `windows-x86_64` | NSIS `-setup.exe`   | NSIS `-setup.exe` |

Both macOS targets build on the Apple Silicon runner. Intel uses the
`x86_64-apple-darwin` Rust target and a matching x64 Node sidecar.

Tauri gives both macOS updater archives the same base filename. The workflow appends the
target architecture to the archive and signature before upload so the two releases cannot
overwrite one another.

### Direct CLI invocation

The workflow invokes the installed Tauri CLI directly rather than wrapping it in
`tauri-action`. `vp build` still runs through `beforeBuildCommand`, while the workflow can
pass exact target and bundle arguments consistently across the matrix.

### Optional release-note summary

After Release Please creates a release, an OpenRouter step may place a concise user summary
above the unchanged generated changelog. The script—not the model—combines the two sections.

The step fails open. A missing key, request error, or empty result leaves the generated
notes intact and does not block artifacts. `CHANGELOG.md` is never model-written.

### Manual recovery

A manual workflow run without a tag builds the platform matrix without uploading assets. A
run with an existing tag uploads/replaces the bundles and regenerates the updater manifest.

This is the supported recovery path for incomplete release assets and the safest smoke test
for workflow changes.

## Updater integration

General setup, signing, permissions, and static JSON schema belong to the
[Tauri updater guide](https://v2.tauri.app/plugin/updater/). PyOps adds two pieces.

### Aggregated `latest.json`

Each matrix job emits one fragment containing its target's artifact URL and detached
signature. The final job merges all four fragments and adds:

- the tag version without its `v` prefix;
- the finalized GitHub release body as `notes`;
- a UTC publication time.

It uploads the result as `latest.json` to the release. `tauri.conf.json` points the updater
at `releases/latest/download/latest.json`.

The updater artifact is selected explicitly per target. Install-only `.deb` and `.dmg`
outputs may also have signatures, so choosing the first signature would produce an invalid
manifest.

### Web-client boundary

`app/src/lib/updater.ts` dynamically imports Tauri plugin APIs only after confirming the
desktop runtime. The ordinary browser application remains Tauri-agnostic.

`UpdatePrompt` checks once on launch, renders the release body as Markdown, streams download
progress, installs the pending signed artifact, and relaunches through the process plugin.

Use `?mockUpdate=1` or `?mockUpdate=long` in a development browser to verify the prompt and
long release-notes layout without a native bundle. The mock path exists only in development.

Self-update uses AppImage, `.app.tar.gz`, and NSIS artifacts. The `.deb` remains a
package-manager/manual-install path.

## Signing material

The updater public key is embedded in `tauri.conf.json`. CI receives the private key and
password through `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The private key must be backed up outside the workflow secret store. Losing it breaks the
trust path from installed versions to newly signed updater artifacts.

Platform installer signing and notarization are separate concerns; follow Tauri's current
[distribution guidance](https://v2.tauri.app/distribute/) rather than duplicating it here.

## Verification checklist

For a PyOps desktop change:

1. Run the app checks and production server build.
2. Run `vp run tauri dev` and verify server startup, delayed reveal, external links,
   single-instance focus, window restore, and clean shutdown as applicable.
3. Use the mock update query for updater UI changes.
4. Build a native bundle after changing resource paths, capabilities, sidecar handling, or
   updater configuration.
5. Confirm the bundle contains the Nitro server, migrations, mod source, and correct Node
   architecture.
6. Use a build-only manual workflow dispatch after changing the release matrix or manifest
   assembly.

A successful browser build does not verify native paths, capability grants, updater trust,
or bundle contents.
