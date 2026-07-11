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

1. Open **TURD**.
2. Search by the master upgrade or branch name when necessary.
3. Expand a master and compare the offered recipe changes.
4. Select the branch that matches the playthrough or the choice you want to evaluate.

<AppScreenshot
  src="/images/turd-upgrades.png"
  alt="The dark-mode TURD upgrades page showing Arqad and Arthurian branch choices and their recipe changes"
  caption="Each master groups mutually exclusive branches. Changed recipe lines make the affected inputs, outputs, and productivity bonuses explicit."
/>

PyOps re-solves blocks affected by the changed recipes. Review **Factory** and
**Coherence** afterward: an output may remain the same while its upstream inputs change
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
4. Open Coherence and check whether previously balanced block connections changed.

If the game's live selection and the project disagree, treat the live game state as the
source of truth for a plan intended to match that save.
