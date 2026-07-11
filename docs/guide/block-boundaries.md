---
title: Control block boundaries
description: Decide what a block imports, makes internally, exports, or routes as a byproduct.
outline: [2, 3]
---

# Control block boundaries

A boundary keeps a production plan understandable. Goods consumed but not fully made
inside the block cross the boundary as **Imports**. Net production leaves as a goal,
surplus, or byproduct **Export**.

## Leave a good as an import

An ingredient can remain an import even when a recipe inside the block could make it. This
is useful when another block, a train network, or an existing part of the save supplies it.

Right-click an import to:

- **Create block to make this** using the current import rate as the new block's starting
  goal;
- **Size block by this input** when a fixed incoming supply should determine this block's
  output;
- jump to an existing block listed under **produced in**.

Sizing by an input locks that import rate and derives the primary goal from it. Use
**Unlock sizing** from the same menu to return control to the goal rate.

## Make a good inside the block

Left-click an ingredient or import chip to open **Recipes that make _good_**, then select a
producer. This is the normal workflow. Adding a producer through the good's recipe picker
automatically links its production to the block's consumers and prevents the solver from
importing the shortfall.

The right-click actions are explicit boundary overrides:

- **Make in this block (link production)** links a producer that was added some other way,
  such as through recipe search.
- **Require in-block production** forbids importing the good before a producer has been
  added. The block reports the missing source as a solve warning.
- **Made in this block — click to import instead** removes the requirement and allows an
  import again.

## Handle exports and byproducts

Net production that no selected recipe consumes becomes an export. Right-click an exported
good and select **Make a goal** when the block should guarantee that output rather than
treat it as incidental surplus.

To consume a byproduct inside the block, select its product chip and add a consuming
recipe. When several consumers compete for the same in-block production, right-click a
recipe name and open **Pins — count / cap / route…** to route a fixed percentage to that
row.

::: info Goals and exports can coexist
A goal is a minimum target. Production beyond the requested rate remains visible as an
export, so byproducts and constraint-driven surplus are never silently discarded.
:::

## Split a block when it becomes unwieldy

Right-click a recipe name and select **Extract into new block**. PyOps moves that recipe to
a new supplier block and preserves the boundary rate between the two plans.

Use **New sub-block from this row** when the recipes should remain in one solved block but
need a collapsible visual group. A sub-block changes presentation unless you explicitly
promote it to a separately solved module.

Choose boundaries that match how the factory will be built and supplied. A mathematically
valid giant block is often less useful than several blocks with clear train, belt, pipe,
or operational boundaries.
