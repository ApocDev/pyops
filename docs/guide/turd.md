---
title: Plan TURD upgrades
description: Compare Pyanodons TURD branches, record a planning choice, and understand how it affects recipes.
outline: [2, 3]
---

# Plan TURD upgrades

TURD is Pyanodons' one-time recipe-upgrade system. A TURD master technology offers
mutually exclusive branches that can replace recipes or change their inputs and outputs.
The decision is effectively permanent in the playthrough, so treat it as a factory-design
choice rather than a routine research unlock.

The **TURD** page appears when the active project's synced data contains TURD upgrades.

## Review and select a branch

The page lists one row per TURD master. Chosen masters come first, then masters whose
branches touch your blocks, then the rest. Each row shows the chosen branch (or the
branches' icons), how many of your blocks it touches, and the science it needs.

1. Open **TURD**.
2. Narrow the list with **Chosen**, **Not chosen**, or **My blocks**, or search by the
   master or branch name.
3. Select a row to expand it. Its branches appear side by side with the same sections in
   line: **Module** (the always-on effect), **Recipe changes**, **New recipes**, and
   **Your blocks**.
4. Select **Choose** on the branch that matches the playthrough or the choice you want to
   evaluate.
5. Review the confirmation, which lists every block that re-solves, and select
   **Choose upgrade**.

**Recipe changes** collapses swaps that differ only by tier into one line, such as
**Moss ×5**, and lists only what changes: craft time, added or removed inputs, and changed
amounts. When the tiers change by different amounts, the line shows the percentage range.
Hover a recipe icon for its full before-and-after comparison.

**Your blocks** lists each block that runs one of the branch's recipes, or a building its
module goes into, with the recipe or building icons that match. **Game text** shows the
in-game description.

The chosen branch shows **Chosen** and a **Clear** button, which removes the choice after
the same confirmation. Choosing or clearing a branch is one undoable action: the undo button
in the main navigation restores the previous choice and re-solves the blocks again.

<AppScreenshot
  src="/images/turd-upgrades.png"
  alt="The dark-mode TURD upgrades page with the Moss farm upgrade expanded into four branches side by side"
  caption="An expanded master lines up its branches: module effect, recipe changes, new recipes, and the blocks each one touches."
/>

PyOps re-solves blocks affected by the changed recipes. Review **Factory → Overview** and
**Factory → Connections** afterward: an output may remain the same while its upstream inputs change
substantially.

::: warning A PyOps selection does not make the choice in Factorio
Selecting a branch records the planning choice in the current PyOps project. Make the
actual permanent choice in-game. When the companion mod is linked, the game's TURD state
syncs back into PyOps and the page shows a green **live** status.
:::

## How the horizon treats TURD recipes

With the planning horizon set to **Now**, recipes belonging to an unselected branch remain
unavailable. Recipe pickers explain which TURD master and branch they require.

PyOps never automatically picks an unselected upgrade. Available branches remain visible
for comparison, while blocks continue to reflect the recorded choice.

## Recheck affected plans

After changing a selection:

1. Wait for **re-solving blocks…** to finish.
2. Open blocks using the affected recipes and confirm their imports, machines, and fuels.
3. Open Factory and check for new deficits or obsolete upstream production.
4. Open **Factory → Connections** and check whether previously balanced block connections changed.

If the game's live selection and the project disagree, treat the live game state as the
source of truth for a plan intended to match that save.
