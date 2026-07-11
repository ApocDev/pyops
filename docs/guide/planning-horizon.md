---
title: Set the planning horizon
description: Limit recipe choices to the current playthrough, a future factory, or one target technology.
outline: [2, 3]
---

# Set the planning horizon

The planning horizon controls what PyOps is allowed to use in blocks, recipe pickers, and
Assistant proposals. Set it before making detailed recipe choices so the plan does not
quietly depend on technology you did not intend to use.

On a wide screen, open **Horizon: _current mode_** near the top-right of the navigation
bar. On a narrow screen, open the navigation menu first. The same controls are also under
**Settings → Planning**.

<AppScreenshot
  src="/images/planning-horizon-dialog.png"
  alt="The Planning horizon dialog with Now, Future, and Up to target modes"
  caption="The navigation label always shows the active mode. A live research count appears when a linked game has synced technologies."
  compact
/>

## Choose a mode

### Now

Use **Now** when the plan should match the current stage of a playthrough.

- Under **science packs you produce**, select each pack that is continuously available.
- Add individual technologies under **completed research** when pack availability alone
  does not describe a one-off unlock.
- Leave **mining productivity bonus** blank to derive it from synced research, or enter a
  manual percentage when planning without a live research sync.

A recipe counts as available when all science packs required by its research are selected,
or when its unlocking technology is in the completed-research list. When the companion mod
is linked, completed technologies sync from the game and **Now** follows the save.

::: tip Research sync and mode are separate
The green **live · _n_ techs synced** status can appear in every mode. Synced research only
limits recipe availability while **Now** is selected.
:::

### Future

Use **Future** to sketch a factory without a research limit. All recipes can be selected,
while their technology information remains visible in the picker. This is useful for
end-game designs, but it can introduce machines or recipes that the current save cannot
build yet.

### Up to target

Use **Up to target** when planning toward a specific item or fluid without opening the
entire future technology tree.

1. Search for the target good.
2. Select it from the results.
3. Confirm the displayed unlocking technology and allowed science-pack tier.

PyOps allows the technology that unlocks the target and its prerequisites, but excludes
technology beyond that point.

## What changes when the horizon changes

PyOps refreshes recipe and machine availability and re-solves affected blocks. Existing
recipe choices are not silently replaced. If a selected recipe is outside the new horizon,
the block and recipe picker show its locked state so you can change the plan deliberately.

TURD selections are another part of availability. In **Now**, a recipe that requires an
unselected TURD choice remains unavailable even when its ordinary research requirements
are satisfied.
