---
title: Keyboard and navigation
description: Move quickly between pages, blocks, goods, projects, and common actions.
outline: [2, 3]
---

# Keyboard and navigation

The command palette is the quickest way to move around a large project. Open it with
<kbd>Ctrl</kbd>+<kbd>K</kbd> on Windows or Linux, <kbd>Command</kbd>+<kbd>K</kbd> on macOS,
or <kbd>/</kbd> when the cursor is not in a text field.

## Use the command palette

Start typing to search across:

- PyOps pages;
- blocks in the active project;
- items and fluids in the synced game data;
- actions such as **New block**, **New project**, and **Undo last action**.

An empty search shows recently visited blocks and goods. Use the arrow keys to select a
result, <kbd>Enter</kbd> to open it, and <kbd>Escape</kbd> to close the palette.

<AppScreenshot
  src="/images/command-palette.png"
  alt="The PyOps command palette searching for automation across blocks and goods"
  caption="Search by what you want, not where it lives. Goods open in Browse and blocks open directly in the editor."
/>

::: tip Search internal names when needed
Visible results use Factorio's localized names, but goods search also recognizes internal
prototype names. This is useful when a mod error or console message gives you only an ID.
:::

## See the shortcuts active on a page

Press <kbd>?</kbd> outside a text field, or open the command palette and choose **Keyboard
shortcuts**. The sheet lists the shortcuts available on the current page.

The global shortcuts are:

| Shortcut                                        | Action                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| <kbd>Ctrl</kbd>/<kbd>Command</kbd>+<kbd>K</kbd> | Open or close the command palette, including while typing |
| <kbd>/</kbd>                                    | Open the command palette outside a text field             |
| <kbd>Ctrl</kbd>/<kbd>Command</kbd>+<kbd>Z</kbd> | Undo the most recent reversible project action            |
| <kbd>?</kbd>                                    | Show active keyboard shortcuts outside a text field       |

## Switch projects and settings

On a wide desktop, the active project and **Settings** are at the top-right of the main
navigation. On narrower windows, open the menu button; the same controls appear in the
navigation drawer.

Project switching changes the complete planning workspace: blocks, tasks, synced reference
data, snapshots, research state, and TURD choices. The OpenRouter key and default Assistant
model belong to the app rather than an individual project.

## Undo a project change

Select the undo button in the main navigation or press
<kbd>Ctrl</kbd>/<kbd>Command</kbd>+<kbd>Z</kbd>. Hover the button to see the action that will
be reverted.

Undo is linear: after reverting an action, continue working from the restored state. Some
destructive app-level actions, such as deleting a project or conversation, require
confirmation and are not part of project undo history. For longer-term recovery, use
[project backups and block snapshots](../guide/backups-and-sharing).
