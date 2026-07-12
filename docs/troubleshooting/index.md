---
title: Troubleshooting
description: Diagnose common setup, data, planning, bridge, and Assistant problems.
outline: [2, 3]
---

# Troubleshooting

Start with the symptom below. Keep a recent [project backup](../guide/backups-and-sharing)
before changing or replacing local data.

## Recipes, icons, or pages are missing

### A new project has no recipes

Each project has its own reference data. Open **Settings → Game data**, select **Sync game
data…**, and complete the sync from the Factorio installation used for that playthrough.
See [Sync game data](../getting-started/sync-game-data) for the full process.

### Mods changed or the navigation says “data stale”

The active project's reference data no longer matches Factorio's enabled mods and versions.
Open the stale-data indicator or **Settings → Game data**, review the detected changes, and
sync again. Existing blocks remain in the project, but recipes changed by the mod set may
need new selections.

### Icons are blank or incorrect

Run **Sync game data…** with **Also re-dump icon sprites** enabled. When icon rebuilding is
selected, let **Dump icon sprites** and **Rebuild icon atlas** finish. If progress appears
stuck before Factorio starts, check Steam for a launch-confirmation dialog.

### Names appear as prototype IDs

Run **Sync game data…** again. The normal sync includes Factorio's localized prototype
names; rebuilding icons is not required for a name-only problem. If a specific entry still
uses an internal ID, include that ID and the mod name and version from **Settings → Game
data** when reporting the problem.

### The TURD page is not in navigation

PyOps shows TURD only when the active project's synced data contains TURD master
technologies. Confirm that the project was synced from the intended Pyanodons mod set. If
the mods changed after the last sync, sync the data again.

## A block does not solve

Read the message above the recipe table first. Then check:

1. Every goal has at least one selected producing recipe.
2. A good marked **Made in this block** has a selected recipe inside the block.
3. Recipe or machine caps are not below the amount required by the goal.
4. A cyclic chain has enough recipes and boundary flows to define a solution.
5. The selected recipes are allowed by the active planning horizon and TURD choices.

See [Work with blocks](../guide/blocks) for solver controls and [Block boundaries](../guide/block-boundaries)
for in-block production and imports.

## The factory still has shortages

A solved block can intentionally import goods. **Factory → Overview** combines all enabled
blocks; **Factory → Connections** shows which imports are not covered by other blocks and which exports are
unused. This is a factory-planning result, not necessarily a block error.

Use [Balance the plan](../guide/balance) to find the deficit, open its consuming block, and
either link production inside that block or create and size a supplier block.

## The wrong project or data appears

Check the active project at the top-right of the desktop navigation or in the navigation
drawer on a narrow window. Projects have separate blocks, tasks, reference data, and save
state.

Open **Settings → Game data → Storage location** to find the exact data and projects folders
used by the running app. Do not replace a project database while PyOps is running. Prefer
**Settings → Backup & share → Import backup…**, which imports a backup as a new project.

## Factorio does not connect

The navigation status explains whether PyOps is waiting for the game, detected a mod
mismatch, or could not bind its UDP port. Follow [Connect PyOps to Factorio](../guide/in-game-link#troubleshoot-the-connection)
for the checks and port settings.

PyOps remains usable without the Companion mod; only live save synchronization and in-game
actions are unavailable.

## The Assistant fails

PyOps currently requires an OpenRouter API key. Key, credit, model, reasoning, context, and
live-state failures are covered under [Troubleshoot the Assistant](../guide/assistant#troubleshoot-the-assistant).

## An update or reinstall does not behave as expected

### No automatic update appears on Linux

The AppImage supports in-app updates; the `.deb` package does not. Install a newer `.deb`
with the system package manager, or switch to the AppImage for future in-app updates. See
[Install PyOps](../getting-started/install#linux-appimage).

### Reinstalling did not remove projects

Projects live in the local data folder rather than the application bundle. Reinstalling or
replacing the executable normally leaves them in place. Open **Settings → Game data →
Storage location** to confirm which folder the running app uses.

### Reinstalling opened an empty workspace

The new launch may be using a different data folder or operating-system account. Check
**Storage location** and any `PYOPS_DATA_DIR` override. If the original folder is not
available, import a project backup under **Settings → Backup & share**.

See [Settings and storage](../reference/settings-and-storage) before moving local files.

## A backup or plan will not import

### The backup is not recognized as a PyOps project

Project import accepts a SQLite `.db` downloaded from **Project backup**. A block or plan
JSON file belongs under **Import block/plan JSON…** instead. PyOps rejects unrelated SQLite
files and databases without PyOps project metadata.

### A JSON export says it came from a newer PyOps

Update PyOps, then import the file again. Export formats are versioned so an older app does
not silently discard planning choices it does not understand.

### Import succeeded but the active project did not change

An imported database always becomes a new project and never overwrites the current one.
Select **Switch to it** in the import result, or choose it from the project selector.

See [Back up and share](../guide/backups-and-sharing) for the difference between database
backups, JSON exports, and block snapshots.

## Ask for help

Search existing reports or open an issue in the
[PyOps GitHub repository](https://github.com/ApocDev/pyops/issues). Include:

- the operating system and PyOps version;
- what you selected and what you expected;
- the complete visible error message;
- whether the problem occurs in a new project;
- whether Factorio, the Companion mod, or the Assistant was involved;
- the enabled mod names and versions shown under **Settings → Game data** when relevant.

Do not attach an OpenRouter key or other secret. Share a project backup only when its
planning data is appropriate to disclose.
