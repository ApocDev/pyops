---
title: Read the Factory view
description: Use whole-plan deficits, surpluses, balanced flows, and stock buffers to choose what to build next.
outline: [2, 3]
---

# Read the Factory view

Open **Factory → Overview** after solving your first block. This page combines the cached
flows from all enabled blocks. It answers a different question from the block editor:

- A block asks, “What does this production unit need and produce?”
- Factory asks, “Across the whole plan, what do I still need to make?”

## The four flow groups

| Group         | Meaning                                                     | What to do                                               |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Deficits      | Enabled blocks consume more of the item than they produce.  | Build or scale an upstream block.                        |
| Surpluses     | Enabled blocks produce more than they consume.              | Route it, use it in another block, or reduce production. |
| Balanced      | Planned production and consumption are effectively equal.   | No immediate planning action.                            |
| Stock buffers | Production exists only to satisfy a **keep in stock** goal. | Treat it as replenishment, not continuous surplus.       |

An active temporary campaign contributes its derived rate to these same totals until you select
**Complete** on its block. Completion disables the block but keeps the campaign definition, so
Factory immediately stops counting its finite build without losing the plan.

The first automation-science block creates deficits for every ingredient left as an
import. Pick one of those deficits and make it the goal of your next block. As you add
producer blocks, return to Factory to see which deficits remain.

Temperature-sensitive fluids retain their boundary contract here. A pinned steam import appears
as **Steam 250°**, and it balances with steam produced at exactly 250°. Other exact temperatures
and wider accepted ranges, such as **Steam ≥15°**, remain separate rows so a high-temperature
supply is not silently counted against the wrong demand. Fluids with only one producible
temperature remain unqualified.

Select a qualified row to see only the blocks connected to that contract. For example, the
**Steam 250°** drawer includes exact 250° producers and consumers pinned to 250°, while the
**Steam ≥15°** drawer lists range-based consumers separately. Creating a block from an exact row
also carries that temperature into the new fluid goal.

<AppScreenshot
  src="/images/first-factory-view.png"
  alt="The Factory page for a five-block Automation science plan, showing deficits, a final-product surplus, balanced intermediates, and live machine sufficiency"
  caption="After adding four supplier blocks, Native flora, Planter boxes, and Small parts are balanced. The remaining deficits identify the next upstream blocks to plan."
/>

::: tip Small residuals are treated as balanced
Factory ignores differences below roughly one percent of an item's throughput. This keeps
hand-entered rates such as `0.083/s` from appearing as actionable deficits against an exact
`0.0833/s` demand.
:::

## Planned totals and live statistics

Factory totals come from your solved PyOps blocks. The **live** indicator is separate: it
shows recent production statistics sent from the game through the companion mod. Seeing
**no live stats** does not stop planning and does not mean the block solve failed.

## Overview and Connections

Overview sums every enabled block by item. **Connections** inspects the block-to-block wiring.
A surplus in one block can cancel a shortfall in another in Factory totals even when those
blocks are not connected as intended. Use Factory to choose what the overall plan needs;
use Connections later to find boundary mismatches that totals can hide.

You now have the core planning loop:

1. Set a goal in a block.
2. Choose recipes and machines until the block solves.
3. Review its imports and exports.
4. Use Factory deficits to choose the next block.
