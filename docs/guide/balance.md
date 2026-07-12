---
title: Balance and scale the plan
description: Use the Factory workspace to find shortages, inspect connections, and preview a larger factory.
outline: [2, 3]
---

# Balance and scale the plan

Open **Factory** to enter the whole-plan workspace. Its three views use the same enabled
blocks, but answer different questions.

| View            | Question                                                           |
| --------------- | ------------------------------------------------------------------ |
| **Overview**    | What does the entire plan produce, consume, and still need?        |
| **Connections** | Do the intended block-to-block supplies match their consumers?     |
| **Scenario**    | How would every block need to change for a new final-product rate? |

Start with [Overview](../getting-started/factory), then use **Connections** when totals can
hide a connection problem and **Scenario** when planning a scale change.

## Find wiring problems with Connections

Factory nets all production and consumption of a good. That can hide a real problem: one
block's surplus can numerically cancel another block's shortage even when the intended
supply path is wrong. **Connections** keeps the producer and consumer blocks visible on each
edge.

Connections groups goods as:

- **Short**: linked consumers require more than their producer blocks provide.
- **Overproduced**: linked producers make more than their internal consumers use.
- **Balanced**: the producer and consumer rates agree; collapsed by default.
- **Unsourced imports**: blocks consume the good, but no enabled block supplies it.
- **Surplus / outputs**: blocks produce the good, but no enabled block consumes it.

On a short good, use **scale up** to select a producer block, enter a new target, and
preview the machines, power, and inputs before applying it. When a good touches many
blocks, select the displayed block count to expand the individual connections.

<AppScreenshot
  src="/images/factory-coherence.png"
  alt="The Factory Connections view for a connected five-block Automation science plan"
  caption="Connections keeps producer and consumer blocks on the same edge, revealing shortages or excess that whole-factory totals can hide."
/>

::: tip Recompute stale block flows
Use **Recompute all blocks** when the page reports stale results after a data sync, TURD
change, or solver update. This re-solves saved blocks; it does not invent new recipes.
:::

## Preview a target with Scenario

Select **Scenario** in the Factory workspace. It solves the enabled blocks as one
speculative system without saving changes.

1. Under **Final products**, edit the rate of the product you want to change.
2. Read **Goal changes** for each affected good's current rate, required rate, and scale
   factor. Select a good to open the block that owns its goal.
3. Check **Raw inputs** for the projected demand from outside the planned factory.
4. Check **Overproduced** for goods that would accumulate without another consumer.
5. With the current final-product targets, select **Balance factory** to apply every listed
   goal change as one undoable action. After editing a final-product target, the same action
   is labelled **Apply scenario**.

Scenario balances goals, not an opaque shared block rate. When a block has an additional
negative goal, it can balance that intake without changing the block's first goal. For example,
if a Tar block consumes Shale oil as its second goal, surplus Shale oil produces a
**Shale oil** row with the required consume rate.

Terminal goals—goods nothing else in the factory consumes—anchor the balance. Intermediate
production goals move to cover downstream demand, while negative goals can move to absorb
surplus. After each change PyOps re-solves the affected block and repeats until its boundary
flows settle. A valid producer currently set to `0/s` is probed at a normalized rate, so
**Balance factory** can start it instead of reporting an infeasible zero-times-scale row.

If no enabled block can supply a required ingredient, Scenario keeps the solve usable and
lists the shortfall under **Raw inputs** as an external import.

Use **reset to current** to discard the speculative target.

<AppScreenshot
  src="/images/factory-what-if.png"
  alt="The dark-mode Factory Scenario view previewing two Automation science packs per second across five connected blocks"
  caption="Changing the final product from one to two per second produces a block-by-block scaling work list without saving the speculative target."
/>

### Supply priority

When several blocks can supply the same good, Scenario uses their supply priority:

1. **Preferred** suppliers are used first.
2. **Normal** suppliers follow.
3. **Fallback** suppliers fill the remaining demand.

Set priority beside the **Goal** heading in a block. Priority chooses among competing
suppliers; it does not scale a block solely to obtain an incidental byproduct.

::: info Scenario is not an optimizer for new designs
Scenario balances the blocks and recipes already in the plan. It can start an idle configured
producer, but it does not add recipes or blocks. Add a producer when an external import should
be made inside the factory.
:::
