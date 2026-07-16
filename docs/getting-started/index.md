---
title: Getting started
description: Install PyOps, sync your Factorio data, and make your first production plan.
outline: [2, 3]
---

<script setup>
import PlanningLoop from "../.vitepress/theme/PlanningLoop.vue";
</script>

# Getting started

This walkthrough takes you from a fresh install to a useful production plan. You will
choose a project, sync its Factorio data, and make a block for one automation science pack
per second.

## What you need

- Factorio 2.1 installed on the same computer as PyOps.
- The mod set and startup settings you want to plan with already configured in Factorio.
- Factorio closed while PyOps performs the initial data sync.

::: info Optional: connect the companion mod
You can complete this walkthrough without the in-game connection. For a plan that follows
your current save, [connect the Companion mod](../guide/in-game-link) under
**Settings → In-game link** and start Factorio from **Live bridge → Launch Factorio**.

The companion mod connects through PyOps' live bridge. It enables the in-game panel,
live research and TURD choices, machine and production statistics, and actions such as
locating a good or showing a block in-game. The navigation status changes from **no game**
to **game linked** when the connection is active.
:::

## The first-run path

Home adapts to the active project. A new project shows these setup steps in order; after
you have a working plan, it becomes a command center for the next block problem, factory
deficit, build shortfall, data drift, and game-link state.

<AppScreenshot
  src="/images/home-command-center.png"
  alt="The Home command center showing the next factory action, balance, build status, project status, recent blocks, and planning shortcuts"
  caption="Once a project has solved blocks, Home leads with the most urgent actionable work and keeps the factory's current state visible without opening every workspace."
/>

### How Home chooses the next action

Home treats fresh in-game evidence as more important than the end-game plan. Recommendations use
this order:

1. **Re-sync game data** when the active mods or PyOps data reader changed.
2. Address a good that **is draining** in the connected factory. This compares the rolling
   one-minute production and consumption rates; it does not claim that belts or storage are already
   empty.
3. **Start** an unbuilt block when none of its required production steps run anywhere.
4. **Finish** a partially built block by establishing at least one machine for every required
   recipe.
5. **Plan** a factory deficit only when a producer is selectable under the current planning
   horizon. Research-locked goods wait without monopolizing the recommendation, and raw/external
   inputs are not presented as producer blocks.
6. **Scale** an operational block only after every required recipe has a working machine. Scaling
   is deliberately quiet: a one-machine trickle counts as built even when the long-term plan calls
   for hundreds.
7. Review unhealthy or unfinished block drafts when no more actionable factory work is visible.

Recipe coverage is currently force-wide: if any compatible machine tier runs the recipe somewhere,
Home counts that step as built. The exact planned machine type and count still determine scaling.
This is intentionally approximate when several blocks share a recipe.

Select **Dismiss for now** to move a recommendation out of the headline for this project. Home
immediately chooses the next available action and shows **Restore _n_ dismissed** in the card
header. A block returns automatically when it advances to a different stage, such as **Start** to
**Finish** or **Finish** to **Scale**; use **Restore** to bring back actions that have not changed.
Re-sync warnings cannot be dismissed because the remaining recommendations may rely on stale data.

1. [Install PyOps](./install).
2. [Choose or create a project](./project) for this factory or mod set.
3. [Sync game data](./sync-game-data) from Factorio into that project.
4. [Build your first block](./first-block) and choose its recipe and machine.
5. [Read the Factory view](./factory) to decide what to plan next.

::: info What PyOps changes
PyOps reads Factorio's prototypes during sync and stores its own plans locally. It does
not change your save during this walkthrough.
:::

## The model in one minute

<PlanningLoop />

A **project** is a separate PyOps database, usually for one save or one mod set. A
**block** is a production unit with a target output, selected recipes, and selected
machines. The **Factory** view combines the solved flows from your enabled blocks so you
can see what the whole plan produces and still needs.

You do not need to describe the entire recipe chain up front. Start with the product you
want, solve one useful block, and use its imports as the next planning decisions.
