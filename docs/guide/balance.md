---
title: Balance and scale the plan
description: Use the Factory workspace to find shortages, inspect connections, and preview a larger factory.
outline: [2, 3]
---

# Balance and scale the plan

Open **Factory** to enter the whole-plan workspace. Its three views use the same enabled
blocks, but answer different questions.

| View            | Question                                                              |
| --------------- | --------------------------------------------------------------------- |
| **Overview**    | What does the entire plan produce, consume, and still need?           |
| **Connections** | Do the intended block-to-block supplies match their consumers?        |
| **Scenario**    | What block goals satisfy the factory pins, and what remains external? |

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

Select **Scenario** in the Factory workspace. It previews the enabled blocks as one speculative
system without saving proposed block-goal changes. PyOps reuses the last result while its factory
inputs remain current, so revisiting the page does not run the solver again. The first visit
calculates automatically; after a block, factory pin, research context, or other solver input
changes, the previous result stays visible and the status bar marks it **Scenario needs
recalculation**.

1. Under **Factory pins**, add the goods that define the factory's desired outputs or
   consumption. Positive rates request production; negative rates request consumption.
2. Edit one or more pin rates. These edits are drafts: they mark the current preview out of date
   without starting a whole-factory solve for every keystroke. Stock goals appear as derived stock
   targets and keep their amount and replenishment window.
3. Select **Recalculate**. This saves the edited pin targets and starts the preview. The status bar
   reports the real phase—preparing block responses, solving the factory model, validating blocks,
   or refining another pass—and keeps the previous result mounted while work continues.
4. Read **Goal changes** for each affected good's current and next block goal, whole-factory use,
   actual block output, and factory surplus. Differences within 1% are treated as balanced so
   rounding-scale corrections do not keep reappearing. Select a good to open the block that owns
   its goal.
5. Check **Raw inputs** for the projected demand from outside the planned factory.
6. Check **Overproduced** for goods that would accumulate without another consumer.
7. With the saved pin targets, select **Balance factory** to apply every listed
   goal change as one undoable action. After editing a final-product target, the same action
   is labelled **Apply scenario**.

Only factory pins are fixed. Every other block goal is a value for Scenario to calculate, including
additional goals in a multi-goal block. On first use, PyOps proposes current terminal positive goals
as initial pins; after you save the list, it uses that explicit list instead. Stock targets are always
included.

A produce goal is a minimum. When another recipe in the same block already makes a needed good as a
coproduct, Scenario keeps the amount the factory uses as that block's goal without requesting extra
dedicated production. **Block output** shows everything the block will actually export and
**Surplus** shows the amount left after projected use. **Recovered supply** calls out the portion of
a goal covered this way. If factory use is genuinely zero, the next goal can still be `0/s` while
unavoidable output remains visible as surplus. To process that excess, open the block and select the
exported good to add a consuming recipe, or route it to a dedicated consume block.

Scenario measures how each configured goal changes its complete multi-goal block, then builds one
factory-wide material model from those local responses. Starting at the pins, it follows required
ingredients to configured positive producers. A reached producer's natural byproduct can drive a
configured consume goal for that same good. PyOps caps the source at the amount needed for its
declared product, so the consumer cannot pull extra source production merely to obtain one of its own
outputs. This allows Coal's natural Tar to feed a Tar consumer without enlarging Coal to manufacture
Ash or Iron plate.

An unpinned consumption goal with no reached byproduct settles at zero, but it remains a consume
goal: its icon still opens consuming recipes and a later factory solve still probes its configured
sink. Pin the good with a negative rate when it should consume a fixed boundary amount even without
an in-factory source. A valid configured producer currently set to `0/s` can likewise be started
because its response is probed in its saved produce or consume direction.

If no enabled block can supply a required ingredient, Scenario keeps the solve usable and
lists the shortfall under **Raw inputs** as an external import.

If the factory material model is infeasible, Scenario shows the conflicting material balances
before the work list. Each conflict states the shortage or excess, the total rate required and
available, and the blocks consuming or supplying that good. A configured producer is called out
when its current multi-goal response cannot scale that output any further. Follow the block links to
change its goals or recipes, add another producer, or reduce the downstream demand. Nothing is
saved from an infeasible preview.

If the factory model solves but the proposed rates fail a full block re-solve, Scenario shows a
**Scenario validation failed** card before the work list. It links each affected block and lists the
exact proposed goals and block-solver status. Material-flow mismatches show the expected and actual
rates; a solve that does not settle shows the goals still changing between passes. Scenario does not
save any of these proposed rates.

Use **Reset to current** to discard draft target overrides. If the factory itself changed, the
cached result remains marked out of date until you select **Recalculate**.

To inspect an unexpected result, enable **Capture structured solver traces** under
**Settings → Advanced**, reproduce the Scenario calculation, then return there and select
**Refresh**. The trace contains the pins, required-good closure, block-response columns,
generated LP model, validation passes, imports, surplus, and final result as JSON.

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

For fluids, Scenario first removes suppliers whose output temperature is outside the consuming
recipe's accepted range or exact temperature choice. Supply priority then chooses among the
remaining compatible blocks. A preferred 2000°C steam block therefore cannot satisfy a recipe
pinned to 250°C; a compatible normal or fallback supplier is used instead.

::: info Scenario is not an optimizer for new designs
Scenario balances the blocks and recipes already in the plan. It can start an idle configured
producer, but it does not add recipes or blocks. A required good with no reached configured producer
remains a **Raw input**; add and configure a producer when it should be made inside the factory.
:::
