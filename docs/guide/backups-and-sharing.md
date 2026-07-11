---
title: Back up and share plans
description: Protect a complete project, move blocks between projects, and restore an individual block snapshot.
outline: [2, 3]
---

# Back up and share plans

PyOps provides three levels of protection and portability:

| Tool            | Scope                                     | Use it for                                                |
| --------------- | ----------------------------------------- | --------------------------------------------------------- |
| Project backup  | The complete active project database      | Disaster recovery or moving a project to another computer |
| Block/plan JSON | One block or all blocks and their folders | Sharing designs or copying plans into another project     |
| Block snapshot  | One block at a point in time              | Comparing or undoing a substantial block edit             |

## Back up a complete project

Open **Settings → Backup & share**, then select **Download “_project_”** under
**Project backup**.

The downloaded database contains that project's planning data, including blocks, goals,
tasks, notes, planning settings, and synced Factorio reference data. App-level
configuration such as the active-project selection and Assistant API key is stored
separately and is not part of the project backup.

<AppScreenshot
  src="/images/backup-and-share.png"
  alt="The dark-mode Backup and share settings page with project database and block-plan export controls"
  caption="A project backup protects the complete database. JSON export is for portable block definitions rather than full recovery."
/>

### Restore a project backup

1. Open **Settings → Backup & share**.
2. Select **Import backup…**.
3. Choose a PyOps `.db` backup.
4. Select **Switch to it** when the import finishes, or use the project selector.

An imported backup always becomes a new project. It does not overwrite the active project
or another database with the same name.

::: tip Keep backups outside the PyOps data directory
Copy important backups to another disk or a synchronized backup location. A file stored
beside the working database does not protect against disk loss or accidental directory
removal.
:::

## Share blocks as JSON

Use JSON when the recipient needs the design but not the complete project database.

### Export one block

Open the block and select **Export block** in its toolbar. The JSON includes the block's
goals, recipes, machines, fuels, modules, constraints, and other planning choices.

### Export the whole plan

Open **Settings → Backup & share** and select **Export all blocks (_n_)**. The plan export
also preserves block folders.

### Import a block or plan

1. Switch to the project that should receive the design.
2. Open **Settings → Backup & share**.
3. Select **Import block/plan JSON…** and choose the file.
4. Open the imported block links shown in the result and review them.

Imports always create new block copies. When a name already exists, PyOps adds a suffix.
If the receiving project's Factorio data lacks a referenced recipe or good, the block is
still imported and marked with its missing references so the incompatibility can be fixed
deliberately.

::: warning JSON is not a complete project backup
Block and plan JSON does not include tasks, notes, synced game data, or every project
setting. Use the database download when the goal is full recovery.
:::

## Take and restore block snapshots

Open a block and select **Snapshots** in its toolbar.

1. Enter an optional label describing the safe point.
2. Select **Snapshot now**.
3. Use **Diff** to compare a snapshot with the block on screen.
4. Use **Restore** to replace the block definition with that snapshot.

<AppScreenshot
  src="/images/block-snapshots.png"
  alt="The Snapshots panel for Automation science pack with one labeled manual snapshot and one automatic snapshot"
  caption="Labels make manual restore points easy to recognize. Diff shows what changed before a restore is applied."
  compact
/>

PyOps also creates automatic snapshots around structural or destructive block changes and
periodically during ordinary edits. It keeps the newest 20 automatic snapshots per block.
Manual snapshots remain until they are deleted.

Restoring is safe to explore: PyOps snapshots the block's pre-restore state first, and the
restore itself participates in the app's undo history.
