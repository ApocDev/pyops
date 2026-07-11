---
title: Development configuration
description: Configure source runs, custom deployments, bundled resources, and remote development access.
outline: [2, 3]
---

# Development configuration

The [advanced user configuration](../reference/advanced-configuration) documents supported
Factorio, storage, bridge, and Assistant overrides. This page covers variables intended
for source runs, tests, packaging, and custom deployments.

Set local source-run values in `app/.env.local` or in the environment that launches
`vp dev`. Do not commit keys, machine-specific paths, or local data directories.

## Runtime and resource paths

| Variable                 | Development default                      | Purpose                                                          |
| ------------------------ | ---------------------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`           | Active project database                  | Bypass project selection and connect directly to one SQLite file |
| `PYOPS_RESOURCE_DIR`     | Current `app/` working directory         | Root for read-only resources bundled with the server             |
| `PYOPS_MIGRATIONS_DIR`   | `<resource-dir>/drizzle`                 | Override the Drizzle migration directory                         |
| `PYOPS_MOD_DIR`          | `../mod` from the resource directory     | Override the Companion mod source installed by Settings          |
| `FACTORIO_SCRIPT_OUTPUT` | Platform Factorio `script-output` folder | Override where Assistant screenshot tools read Factorio captures |

`PYOPS_DATA_DIR` is the writable root. `PYOPS_RESOURCE_DIR` is the read-only bundle root.
Keep that boundary intact: packaged resources may not be writable, while project databases,
generated icons, and app configuration must be.

The Tauri launcher sets the data, migration, and mod paths for the packaged app. Application
code should import the resolved constants from `app/src/server/paths.server.ts` rather than
joining new paths from `process.cwd()`.

::: warning Direct database mode bypasses projects
When `DATABASE_URL` is set, the database layer uses that file instead of the project
selected in `app-config.json`. Use `PYOPS_DATA_DIR` when you need an isolated but otherwise
normal multi-project workspace.
:::

## Development host allowlist

The Vite development server accepts the tunnel-provider domains configured in
`app/vite.config.ts`. Add comma-separated hostnames with `PYOPS_ALLOWED_HOSTS`:

```sh
PYOPS_ALLOWED_HOSTS=planner.example.test,phone.example.test vp dev
```

Set it to `true` or `all` only in a controlled development environment to allow any host.
This changes host-header validation; it does not provide authentication or make PyOps safe
to expose publicly.

The repository helper chooses an installed tunnel provider and exposes port `3000`:

```sh
scripts/tunnel-dev --help
```

Run it from the repository root. Keep the UDP bridge local even when the web development
server is reachable from another device.

## Test isolation

The Playwright configuration starts read-only and mutating servers on separate ports. The
mutating server points `PYOPS_DATA_DIR` at a seeded scratch directory so destructive tests
cannot change the active development project.

`PYOPS_NITRO_BUILD_DIR` gives concurrent test servers separate Nitro output folders. It is
a test/build isolation control rather than an application setting. See `app/e2e/README.md`
for the server matrix and seed workflow.

## Precedence and verification

Environment overrides are resolved when the server process starts. Restart after changing
them, then verify the effective state in the relevant surface:

- **Settings → Game data → Storage location** for writable paths;
- **Settings → In-game link** for Factorio and bridge behavior;
- **Settings → Planning → Assistant** for environment-controlled key/model indicators;
- server startup output for host and build configuration.

Run `vp env doctor` when the Vite+ environment or package-manager behavior appears wrong.
