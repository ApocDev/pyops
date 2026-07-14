---
title: Work with blocks
description: Create, size, and refine production blocks with goals, recipes, machines, fuels, and modules.
outline: [2, 3]
---

# Work with blocks

A block is one production unit. You choose its goals, recipes, machines, and constraints;
PyOps calculates the rates, building counts, power, pollution, and flows across its
boundary.

Blocks do not need to match one physical building. A block can represent one recipe, a
complete production chain, or a section of the factory you want to build and operate as a
unit.

## Set goals and rates

Select **New block**, then use **+ goal** to choose an item or fluid.

- The first goal starts at `1/s`, names the block, and becomes its scaling anchor.
- Select a displayed rate to edit it. Select its unit to work in `/s`, `/min`, or `/h`.
- Enter a negative rate when the block should consume that item or fluid rather than produce
  it. For example, `-10/min` makes the block consume at least 10 per minute.
- Add more goals when the same production unit must guarantee several outputs.
- Right-click a non-primary goal and select **Move to front (names the block)** to make it
  the primary goal.

Right-click a goal and select **Keep in stock instead (buffer, not throughput)** when the
intent is to refill a quantity over time rather than sustain a continuous rate. Stock-only
production appears separately in Factory.
The solver rate is always the stock amount divided by its refill window; an older saved rate
cannot turn a buffer goal back into continuous production.

A negative goal is already the block's visible import contract, so Block balance does not
repeat that good under **Imports**. Other ingredients the block needs still appear there.
Electricity is listed first, followed by the remaining imports from highest to lowest rate.

## Add recipes

Select a positive goal icon to open **Recipes that make _goal_**. A negative consume goal
instead opens **Recipes that consume _goal_**. Within a recipe row:

- Select an ingredient chip to find recipes that make that ingredient.
- Select a product chip to find recipes that consume that product.
- Alt+Click any item or fluid icon to open the **Recipe explorer** without leaving the current
  page. Switch between **Recipes** and **Uses** to inspect every producer or consumer, including
  availability, machines, and filters; select an ingredient or product inside the dialog to
  keep walking the graph.
- Hover recipe, technology, and item details when you need the precise inputs, outputs, or
  unlock status.

The picker puts choices already unlocked in the synced save first, then recipes available
later in the current planning horizon, and finally locked choices. It sorts each group by
ascending estimated cost, so the first row is normally the cheapest recipe you can build
right now. A recipe is available only when both its own research and at least one compatible
building are available. Locked rows are disabled and name the missing recipe research or
building research; recipes replaced by a TURD upgrade remain visible with their explanation.
PyOps never adds a full chain without your choice.

## Organize recipes into sub-blocks

Right-click a recipe name and select **New sub-block from this row** to start a named,
collapsible group. Drag another recipe onto the sub-block header or one of its indented rows
to add it. Drag the sub-block header to move the whole group together.

Grouping is visual by default and does not change the solve. Use the module control on the
sub-block header when the grouped recipes should instead solve as a separate module with its
own internal goals and a boundary contract for the parent block.

## Choose machines, fuels, and modules

Each recipe row shows its selected machine and required building count.

- Select the machine to choose another compatible option.
- For a fuel-burning machine, select its fuel indicator to choose an allowed fuel.
- Use the module control to fill module slots or override the block's preferred defaults.

Global preferred machines, fuels, and module-fill behavior live under
**Settings → Planning**. A choice made directly on a recipe row overrides the relevant
default for that row.

Fractional building counts are exact capacity requirements. `0.5` means half of one
machine's capacity; `5.2` means five machines are insufficient and six provide spare
capacity. PyOps leaves the construction decision visible instead of rounding the solve.

When **Logistics → Inserters / loaders** is enabled, an amber hammer and a second count can
appear beneath the solved building count. It is the suggested physical build count: the
selected movers, item inputs and outputs, fuel, burnt results, and active fluid connections
need more adjacent access positions than the capacity-rounded buildings provide. The
estimate uses the selected machine's footprint and increases the whole-building count until
those connections fit around its perimeter.

This is a conservative loading estimate, not a generated layout. It does not prove that
belts and pipes can reach every access position, account for beacon spacing, or model direct
insertion and circuit-controlled sharing. Hover the badge to see the footprint, position
budget, and selected mover used by the estimate. Machine footprints populate during
**Settings → Data sync**; an existing project may need one sync before the badge appears.

## Read the result

The **Block balance** card summarizes:

- whether the selected goals and constraints solve;
- energy and pollution totals;
- goods entering as imports;
- goods leaving as goals, surplus, or byproducts.

Select an exported good to add a recipe that consumes its surplus inside the block. The
selected consumer runs as part of the chain, including when one of its products feeds back
into another recipe in the block.

The recipe table explains how that result was produced. **Table** is the editing view;
**Flow** is a read-only diagram of the same solved recipes and goods.

Variable generators show their average planned output and their minimum–maximum range on
the electricity product chip. Building counts and block balances use the displayed average;
the range shows how far live generation can move as the underlying surface condition changes.

::: warning A solved block is not necessarily self-contained
A block can solve while importing ingredients. This is intentional: the block boundary
defines what another block or the existing factory must supply. Continue with
[Block boundaries](./block-boundaries) to control that behavior.
:::

## Disable a block without deleting it

Use the power control in the block toolbar to disable a block. Its recipes and settings
remain saved, but Factory and other whole-plan views exclude it. Re-enable it when the
production unit should participate in the plan again.

## When the solve is infeasible

Read the diagnosis in **Block balance** before adding more recipes. Typical conflicts are:

- a goal with no recipe that makes it;
- a good marked for in-block production without an enabled producer;
- an exact building-count pin that conflicts with a goal;
- multiple constraints demanding incompatible rates in a cyclic chain.

Use the suggested fixes in the diagnosis. Removing constraints one at a time is usually
more informative than adding every candidate recipe.
