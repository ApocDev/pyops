---
title: Advanced configuration
description: Override Factorio paths, local storage, the bridge, and Assistant settings for custom launches and source runs.
outline: [2, 3]
---

# Advanced configuration

Most users should configure PyOps in **Settings**. Environment variables are useful for a
nonstandard Factorio installation, portable or isolated data, a fixed bridge port, a
managed Assistant configuration, or a source checkout.

Set variables in the environment that launches PyOps. Source runs can also use
`app/.env.local`. Restart PyOps after changing them.

## User-facing overrides

| Variable             | Default                                      | Purpose                                                                       |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `FACTORIO_BIN`       | Standard Steam path on Linux                 | Factorio executable used by game-data sync and **Launch Factorio**            |
| `FACTORIO_DATA_DIR`  | `~/.factorio`                                | Factorio user-data folder containing `mods` and `script-output`               |
| `PYOPS_DATA_DIR`     | Platform app-data folder in a packaged build | Root for project databases, icon data, and app configuration                  |
| `PYOPS_BRIDGE_PORT`  | `37657`                                      | UDP port on which PyOps listens for the Companion mod                         |
| `OPENROUTER_API_KEY` | Stored Settings value                        | OpenRouter key; an environment value takes priority over Settings             |
| `PYOPS_AGENT_MODEL`  | Stored model, then PyOps default             | OpenRouter model ID; an environment value forces every conversation to use it |

`FACTORIO_DATA_DIR` must be the user-data folder, not the installation folder. For a Steam
installation, `FACTORIO_BIN` points to the game executable while `FACTORIO_DATA_DIR` points
to the profile that owns `mod-list.json` and the `mods` directory.

::: warning Keep the two UDP ports different
`PYOPS_BRIDGE_PORT` is the app-side receive port. Factorio's `--enable-lua-udp` argument
opens a separate game-side port. With the default app port, use a command such as
`--enable-lua-udp 37658` and leave the Companion mod pointed at `37657`.
:::

## Assistant precedence

Assistant configuration resolves in this order:

1. `OPENROUTER_API_KEY` overrides the key stored under **Settings → Planning**.
2. `PYOPS_AGENT_MODEL` overrides both the app default and every conversation selection.
3. Without the environment override, a conversation selection overrides the stored app
   default.
4. Without any selection, PyOps uses its built-in default model alias.

Settings marks an environment-controlled value and disables controls that cannot take
effect. Remove the environment variable and restart PyOps when you want the UI to manage
that value again.

## Isolate or move local data

Set `PYOPS_DATA_DIR` before launch to keep all writable state under a chosen folder:

```sh
PYOPS_DATA_DIR="$HOME/pyops-data" ./PyOps_*_amd64.AppImage
```

This is useful for a portable test workspace or a separate source-run database. The target
folder will contain `projects/`, `icon-data/`, and `app-config.json`.

To move an existing installation safely:

1. Download a complete backup of every project you need.
2. Close PyOps.
3. Launch with the new `PYOPS_DATA_DIR`.
4. Import each backup under **Settings → Backup & share**.
5. Re-enter the OpenRouter key if you use the Assistant.

This workflow avoids copying open SQLite files and makes the new project registry
explicit.

## Source and deployment overrides

Developers and custom deployments can also set `DATABASE_URL` to use one SQLite file
directly or `PYOPS_ALLOWED_HOSTS` to admit extra hostnames to the development server.
These bypass normal project or host behavior and are documented with the
[development configuration](../development/configuration).
