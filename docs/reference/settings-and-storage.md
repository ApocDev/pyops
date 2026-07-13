---
title: Settings and storage
description: Understand which settings belong to the app, which belong to a project, and where PyOps stores local data.
outline: [2, 3]
---

# Settings and storage

PyOps stores its planning data locally. Open **Settings** from the top-right of the wide
desktop navigation or from the navigation drawer on a narrower window.

## Find a setting

| Settings tab       | What it controls                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| **Planning**       | Solver preferences, display options, Assistant access, planning horizon, and recipe exclusions |
| **Game data**      | Reference-data sync, detected mod versions, data drift, and local storage paths                |
| **In-game link**   | Companion mod installation, Factorio launch, UDP bridge status, and live-state sync            |
| **Backup & share** | Complete project backups and portable block JSON files                                         |
| **Advanced**       | Opt-in diagnostic tools for investigating planner behavior                                     |

The active project selector is separate from Settings. It appears beside Settings on a
wide desktop and near the bottom of the navigation drawer on narrower windows.

## Know what changes with the project

Each project keeps its own:

- synced Factorio recipes, goods, technologies, machines, and mod versions;
- blocks, groups, snapshots, tasks, and notes;
- planning horizon, manually recorded research, recipe exclusions, and TURD selections;
- Factory Overview and Connections data derived from those blocks;
- conversations associated with that planning workspace.

Switching projects changes all of that state together. This lets one PyOps installation
hold factories with different saves or mod sets without mixing their recipes and plans.

The OpenRouter key and default Assistant model are app-level settings. They remain the same
when you switch projects and are not included in a project backup.

## Capture a factory solver trace

Open **Settings → Advanced** and enable **Capture structured solver traces**. The next visit to
Factory Scenario—or the next **Balance factory** action—records the factory pins, required-good
closure, normalized block columns, generated LP model, imports, surplus, and final status.

Return to **Settings → Advanced**, select **Refresh**, and inspect, copy, or download the JSON.
Only the latest trace is kept in memory, and it disappears when PyOps exits or you select
**Clear**. Traces include planner names, internal prototype IDs, and rates, so review them before
sharing. They do not include API keys or unrelated app configuration. Leave tracing disabled
during ordinary use.

## Find the data folder

Open **Settings → Game data → Storage location**. PyOps shows copyable paths for:

- **Data folder** — the root of all writable PyOps state;
- **Projects (databases)** — one SQLite database for each project;
- **Icon atlas** — generated sprites and their manifest;
- **App config** — active-project and Assistant account settings.

Packaged builds normally use these platform data folders:

| Platform | Default folder                                       |
| -------- | ---------------------------------------------------- |
| Windows  | `%APPDATA%\com.apocdev.pyops`                        |
| macOS    | `~/Library/Application Support/com.apocdev.pyops`    |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/com.apocdev.pyops` |

The path shown in Settings is authoritative. An advanced launch can override the location,
and a source checkout uses its working directory unless configured otherwise.

::: warning Close PyOps before manual file operations
Do not replace, rename, or edit an active project database while PyOps is running. Use the
in-app backup importer whenever possible; it validates the file and creates a new project
instead of overwriting the current one.
:::

## Back up the right data

A project `.db` backup contains the complete selected project, including its synced
reference data. It does not contain app-level configuration or the OpenRouter key. A block
JSON export contains only portable block definitions and is not a disaster-recovery
backup.

See [Back up and share](../guide/backups-and-sharing) for download, import, snapshot, and
restore instructions.
