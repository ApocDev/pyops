---
title: Explore recipes and dependencies
description: Inspect goods, recipes, properties, prerequisites, and downstream effects without changing a block.
outline: [2, 3]
---

# Explore recipes and dependencies

Open **Explore** from the main navigation. Use **Search** for one good and its immediate
recipes, or **Dependencies** for the transitive tree around a good or recipe. Both read the
active project's synced Factorio data and do not change the plan.

## Inspect a good with Search

1. Open **Explore → Search**.
2. Search under **items & fluids** using the localized name.
3. Select a result.

The detail pane shows the good's properties, its estimated price in ¥ per unit, and two
recipe lists:

- **Produced by** lists recipes that create it, cheapest per unit first within each
  availability group. Each row has a bar of its ¥ per unit of the selected good, on one
  scale for the whole list. The solid part is the good's price. The hatched part is waste,
  the value the recipe spends beyond what its products are worth. A recipe with several
  outputs splits its cost by each output's share of the output value.
- **Consumed by** lists recipes that use it, busiest first, with their cost per craft.

Recycling and void recipes are hidden by default. Turn on **Recycling & void** in a list's
header to show them in their own group at the bottom.

On a wide window the two lists sit side by side. On a narrow window they become two tabs,
**Produced by** and **Consumed by**.

¥ is the cost analysis estimate of a recipe's inputs, machine time, and power. It is not an
in-game currency. Lower is cheaper.

Select an ingredient or product chip to move to that good and walk through the recipe
graph. This is useful when comparing overhaul-mod recipe tiers or tracing an unfamiliar
intermediate back toward raw resources.

Search also shows relevant properties such as stack size, fuel value, spoilage, and fluid
temperature. The internal prototype name is available for debugging and Assistant
references, but ordinary planning uses the localized display name.

<AppScreenshot
  src="/images/explore-iron-plate.png"
  alt="The Explore Search view for Iron plate, with producer recipes on a price ladder beside the consumer list"
  caption="Producers of Iron plate ranked by ¥ per plate. The cheapest available recipe still wastes 75% of its input value."
/>

## Walk the full tree with Dependencies

1. Open **Explore → Dependencies**.
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
  alt="The Explore Dependencies view for Automation science pack in Requires mode at depth three"
  caption="Large graphs are capped. Expand a branch or use its explore-from-here action to continue with a narrower root."
/>

## Which view should I use?

| Need                                                             | View                            |
| ---------------------------------------------------------------- | ------------------------------- |
| Compare recipes that make one item                               | Search                          |
| Check an item's fuel, stack, spoilage, or temperature properties | Search                          |
| Trace every prerequisite several tiers upstream                  | Dependencies → requires         |
| Find everything affected if a good becomes unavailable           | Dependencies → required by      |
| Add a recipe to the current plan                                 | Open the relevant block instead |

::: warning Dependency trees show possibilities, not your selected chain
When several recipes can produce a good, Dependencies shows those alternatives. It does not assume
which one you intend to use. Your block's selected recipes remain the authoritative plan.
:::
