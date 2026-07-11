---
title: Planning guide
description: Learn the PyOps planning workflow after completing the first-run walkthrough.
---

# Planning guide

Use this section after completing [Getting started](../getting-started/). It explains the
decisions PyOps leaves to you: what technology is available, which recipes belong in a
block, where one production unit ends, and how blocks combine into a factory plan.

## Core concepts

- [Planning horizon](./planning-horizon) controls which technologies the planner may use.
- [Blocks](./blocks) turn one or more output goals into recipe rates, machines, and flows.
- [Block boundaries](./block-boundaries) decide which goods are made inside a block and
  which cross its boundary as imports or exports.
- [Factory](../getting-started/factory) combines every enabled block and shows the net plan.
- [Balance the plan](./balance) with Coherence and What-if after several blocks interact.
- [Explore recipes and dependencies](./explore) without changing the plan.
- [Plan TURD upgrades](./turd) and review the recipe changes before committing in-game.

## A practical planning loop

1. Set the horizon to match the stage of the playthrough you are planning.
2. Create a block and add the product you want as its first goal.
3. Select recipes and machines until the block solves.
4. Decide whether each ingredient belongs inside this block or should remain an import.
5. Open **Factory** and choose the next deficit to plan.
6. Repeat, revisiting block boundaries when the plan becomes difficult to operate or
   understand.

::: info PyOps sizes your choices
PyOps solves the recipe rates and building counts for the goals and constraints you give
it. It does not automatically choose an entire recipe chain. That makes the result
predictable and lets the plan reflect the factory you actually intend to build.
:::
