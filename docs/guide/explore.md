---
title: Explore recipes and dependencies
description: Inspect goods, recipes, properties, prerequisites, and downstream effects without changing a block.
outline: [2, 3]
---

# Explore recipes and dependencies

Use **Browse** for one good and its immediate recipes. Use **Deps** for the transitive tree
around a good or recipe. Both read the active project's synced Factorio data and do not
change the plan.

## Inspect a good with Browse

1. Open **Browse**.
2. Search under **items & fluids** using the localized name.
3. Select a result.

The detail pane shows the good's properties and two recipe groups:

- **Produced by** lists recipes that create it.
- **Consumed by** lists recipes that use it.

Select an ingredient or product chip to move to that good and walk through the recipe
graph. This is useful when comparing overhaul-mod recipe tiers or tracing an unfamiliar
intermediate back toward raw resources.

Browse also shows relevant properties such as stack size, fuel value, spoilage, and fluid
temperature. The internal prototype name is available for debugging and Assistant
references, but ordinary planning uses the localized display name.

<AppScreenshot
  src="/images/browse-automation-science.png"
  alt="The Browse page for Automation science pack, with available and research-locked producer recipes"
  caption="Browse groups the recipes that produce a good by current availability and keeps their inputs, outputs, machines, and unlocks visible."
/>

## Walk the full tree with Deps

1. Open **Deps**.
2. Search for an item, fluid, or recipe.
3. Choose a direction:
   - **requires** walks upstream toward ingredients and raw resources;
   - **required by** walks downstream to everything that depends on the selection.
4. Adjust the depth when the default tree is too shallow or too broad.

The tree preserves an important distinction:

- a good can be produced by **any one** of its producer recipes;
- a recipe requires **all** of its ingredients.

Collapsed branches summarize what is underneath them. Locked recipes show their gating
technology, so the tree can double as a research and prerequisite checklist.

<AppScreenshot
  src="/images/deps-automation-science.png"
  alt="The dependency explorer for Automation science pack in Requires mode at depth three"
  caption="Large graphs are capped. Expand a branch or use its explore-from-here action to continue with a narrower root."
/>

## Which view should I use?

| Need                                                             | View                            |
| ---------------------------------------------------------------- | ------------------------------- |
| Compare recipes that make one item                               | Browse                          |
| Check an item's fuel, stack, spoilage, or temperature properties | Browse                          |
| Trace every prerequisite several tiers upstream                  | Deps → requires                 |
| Find everything affected if a good becomes unavailable           | Deps → required by              |
| Add a recipe to the current plan                                 | Open the relevant block instead |

::: warning Dependency trees show possibilities, not your selected chain
When several recipes can produce a good, Deps shows those alternatives. It does not assume
which one you intend to use. Your block's selected recipes remain the authoritative plan.
:::
