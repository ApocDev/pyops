---
title: Build your first block
description: Plan one automation science pack per second and learn how goals, recipes, machines, imports, and exports fit together.
outline: [2, 3]
---

# Build your first block

In this example, the block makes one **Automation science pack** per second. The point is
not to plan the entire science chain at once. It is to learn the block workflow and expose
the ingredients that need their own plans next.

## Create the block

1. Open **Blocks** from the main navigation.
2. Select **New block** in the block sidebar.
3. Add **Automation science pack** as the first goal.
4. Leave the goal rate at `1/s`.

The first goal names the block and becomes its scaling anchor. Changing that rate later
resizes the block while preserving the recipe choices you make.

::: tip Use the localized name
Pick **Automation science pack**, the name shown in Factorio. Internal prototype IDs are
not needed for ordinary planning.
:::

## Choose the recipe and machine

Select the Automation science pack goal icon. The **Recipes that make Automation science
pack** dialog lists every candidate from the synced data, ordered with the most useful
choices first. Select the standard **Automation science pack** recipe, then choose an
available assembling machine in its recipe row.

<AppScreenshot
  src="/images/first-block-recipe-picker.png"
  alt="The dark-mode recipe picker showing recipes that can make Automation science pack"
  caption="The standard recipe appears first here. Availability details underneath each candidate explain research or recycling requirements."
  compact
/>

Fractional counts are intentional. A result such as `0.094` means that one machine has
more capacity than this block needs. You can share that capacity, accept idle time, or
scale the block; PyOps does not round the production math for you.

## Read the block balance

The **Block balance** status tells you whether the selected recipes can satisfy the goals.
A solved block separates its boundary flows into:

- **Imports**: ingredients the selected recipes consume but do not make inside this block.
- **Exports**: products or byproducts that leave the block.
- **Goal**: the target output that anchors the block.

For this first block, leave the ingredients as imports. That gives you a small, useful
science-pack block and a concrete list of upstream products to plan next.

<AppScreenshot
  src="/images/first-block-solved.png"
  alt="A solved Automation science pack block with one goal, one recipe, four imports, and an ash export"
  caption="The solved example produces one Automation science pack per second. Its four imports become candidates for the next blocks."
/>

::: info A block is a boundary you choose
You could add recipes for the imported ingredients to this same block. You could also make
one block per ingredient. Both can be correct: use boundaries that match how you want to
build, operate, and reason about the factory.
:::

## When a block does not solve

Use the diagnosis shown near **Block balance**. The common first-block causes are a missing
recipe for the goal, a recipe whose required ingredient has no source or import boundary,
or a conflict between a goal, a **Made in this block** rule, and a recipe pin. Add or remove
recipes deliberately; PyOps chooses rates for your recipe selection, not recipes on your
behalf.

Once the block shows **solved**, continue to [Read the Factory view](./factory).
