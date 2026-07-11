---
title: Balance and scale the plan
description: Use Factory, Coherence, and What-if to find shortages and preview a larger factory.
outline: [2, 3]
---

# Balance and scale the plan

PyOps provides three whole-plan views. They use the same enabled blocks, but answer
different questions.

| View          | Question                                                           |
| ------------- | ------------------------------------------------------------------ |
| **Factory**   | What does the entire plan produce, consume, and still need?        |
| **Coherence** | Do the intended block-to-block supplies match their consumers?     |
| **What-if**   | How would every block need to change for a new final-product rate? |

Start with [Factory](../getting-started/factory), then use Coherence when totals can hide a
connection problem and What-if when planning a scale change.

## Find wiring problems with Coherence

Factory nets all production and consumption of a good. That can hide a real problem: one
block's surplus can numerically cancel another block's shortage even when the intended
supply path is wrong. **Coherence** keeps the producer and consumer blocks visible on each
edge.

Coherence groups goods as:

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
  alt="The Coherence page for a connected five-block Automation science plan"
  caption="Coherence keeps producer and consumer blocks on the same edge, revealing shortages or excess that whole-factory totals can hide."
/>

::: tip Recompute stale block flows
Use **Recompute all blocks** when the page reports stale results after a data sync, TURD
change, or solver update. This re-solves saved blocks; it does not invent new recipes.
:::

## Preview a target with What-if

Open **what-if →** from Factory or **re-balance all →** from Coherence. What-if solves the
enabled blocks as one speculative system without saving changes.

1. Under **Final products**, edit the rate of the product you want to change.
2. Read **Block changes** for each block's current rate, required rate, and scale factor.
3. Check **Raw inputs** for the projected demand from outside the planned factory.
4. Check **Overproduced** for goods that would accumulate without another consumer.
5. Open an affected block when you are ready to apply its new rate.

Use **reset to current** to discard the speculative target.

<AppScreenshot
  src="/images/factory-what-if.png"
  alt="The dark-mode Factory what-if page previewing two Automation science packs per second across five connected blocks"
  caption="Changing the final product from one to two per second produces a block-by-block scaling work list without saving the speculative target."
/>

### Supply priority

When several blocks can supply the same good, What-if uses their supply priority:

1. **Preferred** suppliers are used first.
2. **Normal** suppliers follow.
3. **Fallback** suppliers fill the remaining demand.

Set priority beside the **Goal** heading in a block. Priority chooses among competing
suppliers; it does not scale a block solely to obtain an incidental byproduct.

::: info What-if is not an optimizer for new designs
What-if scales the blocks and recipes already in the plan. If the result cannot satisfy a
target, add a missing producer, fix an infeasible block, or relax the target before trying
again.
:::
