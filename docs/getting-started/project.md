---
title: Choose or create a project
description: Keep plans and Factorio mod sets separate with PyOps projects.
---

# Choose or create a project

A project is one local PyOps database. It contains the synced recipes, items, machines,
and every plan you create from them.

PyOps creates a **Default** project on first launch. Use it when you have one playthrough
or want to begin immediately. Create a separate project when you change to a different mod
list, a substantially different set of mod settings, or another playthrough whose plans
should stay independent.

## Create another project

1. Open the project selector at the top-right of the navigation bar. On a narrow screen,
   open the navigation menu first; the project selector appears near the bottom.
2. Select **+ new project…**.
3. Enter a recognizable name, such as `Py 2.1 — hard mode`.
4. Select **Create project**.

<AppScreenshot
  src="/images/new-project-dialog.png"
  alt="The dark-mode New project dialog, with a project name field and Create project button"
  caption="A project name is only for identifying the plan; it does not need to match the save file name."
  compact
/>

PyOps switches to the new project and opens **Settings → Game data**. The project starts
empty, so the next required step is to sync Factorio.

::: info Projects are local
Each project is a separate database on this computer. Switching projects reloads PyOps so
that pages cannot accidentally keep data from the previous project.
:::

## Switch projects later

Open the same project menu and select another name. Removing a project from this menu does
not delete its database: PyOps moves the file into a `_removed` folder in its data
directory.

Continue to [Sync game data](./sync-game-data).
