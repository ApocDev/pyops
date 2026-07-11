---
title: Sync game data
description: Import the recipes, items, machines, and localized names from your current Factorio setup.
outline: [2, 3]
---

# Sync game data

Syncing makes PyOps plan against the Factorio version, mods, and startup settings installed
on this computer. Every project keeps its own imported reference data.

## Before you sync

1. Start Factorio normally and confirm the intended mods and startup settings are active.
2. Exit Factorio completely.
3. In PyOps, open **Settings → Game data**.
4. Select **Sync game data…**.

<AppScreenshot
  src="/images/game-data-card.png"
  alt="The Reference data card in Settings with imported recipe, item, fluid, and machine totals"
  caption="The Reference data card summarizes the active project's current Factorio data."
  compact
/>

::: warning Factorio must be closed
The sync starts Factorio in headless modes. Factorio's instance lock prevents that while a
normal game instance is running.
:::

## Choose whether to rebuild icons

The sync dialog offers **Also re-dump icon sprites**.

<AppScreenshot
  src="/images/sync-game-data-dialog.png"
  alt="The dark-mode Sync game data dialog with the optional icon-sprite checkbox and Sync now button"
  caption="Leave icon rebuilding off for routine data refreshes; select it when mod graphics changed or icons are missing."
  compact
/>

- Leave it off for the usual data refresh. PyOps reuses the existing icon atlas.
- Turn it on after a mod changes item, fluid, recipe, or machine graphics, or when icons are
  missing. This loads the full game and takes longer.

::: warning If icon rebuilding appears stuck, check Steam
Steam may open a confirmation dialog asking whether to launch Factorio. This does not
happen on every run, and the dialog may be waiting behind another window. Check Steam and
confirm the launch so the icon dump can continue.
:::

Select **Sync now**. You may hide the progress dialog; the sync continues in the
background.

## What the progress steps mean

| Step                  | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| Prepare dump helper   | Temporarily enables the helper that coordinates the dump.                      |
| Dump prototype data   | Reads Factorio's recipes, items, machines, technologies, and other prototypes. |
| Dump localization     | Imports the names and descriptions shown by the current mod set.               |
| Import into database  | Converts the dump into the active project's planning data.                     |
| Compute cost analysis | Calculates the relative recipe and resource costs used by analysis views.      |
| Apply mod renames     | Updates plans for prototype renames declared by mods.                          |

When icon rebuilding is selected, **Dump icon sprites** and **Rebuild icon atlas** also
appear.

## Confirm the result

A successful run ends at **Reference data updated**. Select **Done**, then check the
**Reference data** card on **Settings → Game data**. It should list non-zero recipe, item,
fluid, and machine counts.

After a later mod change, this page can report that PyOps differs from the game. Use
**Re-sync now** to refresh the project. **Ignore for now** leaves the existing data and
plans unchanged.

Continue to [Build your first block](./first-block).
