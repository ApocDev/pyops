---
title: Concepts and limitations
description: Look up PyOps planning terms and understand what the planner does and does not model.
outline: [2, 3]
---

# Concepts and limitations

PyOps is a production planner built around explicit recipe choices. These terms appear
throughout the app and documentation.

## Planning terms

### Block

A self-contained production calculation with one or more goals and the recipes chosen to
meet them. A block can represent one product, a tightly coupled loop, a mall section, or
another unit that is useful to build and reason about together.

### Goal

The output or stock target that gives a block its scale. Rate goals use items or fluid per
second. Stock goals describe an amount to keep available rather than continuous
production.

### Good

An item or fluid that a recipe consumes or produces. PyOps uses the shared term **good**
when an action applies to both.

### Import and export

A flow across a block boundary. An import is consumed by the block but produced elsewhere;
an export leaves the block for another consumer or as surplus.

### Made in this block

A boundary rule requiring the selected recipes inside the block to cover that good's
consumption. Selecting an ingredient or import and choosing a recipe applies this rule
automatically.

### Factory

The combined net flow of every enabled block. Factory shows the production plan as a
whole, including deficits, surpluses, power, pollution, and required buildings.

### Connections

The Factory workspace's cross-block explanation of supply and demand. It identifies which
blocks consume or produce a good and whether the planned rates cover one another.

### Scenario

The Factory workspace's speculative whole-plan solve. It previews how existing blocks
would need to scale for a changed final-product target without saving the result.

### Planning horizon

The technology boundary used to filter recipe and machine choices: what the current save
can use, anything in the synced data, or everything up to a selected target technology.

### TURD

Pyanodons' mutually exclusive technology-upgrade choice. A selected TURD branch can replace
recipes or change their behavior throughout the project.

### Reference data and live state

**Reference data** is the local recipe, prototype, technology, and mod-version snapshot
created by game-data sync. **Live state** is save-specific information received through the
Companion mod, such as completed research, production, and placed machines.

### Snapshot, backup, and export

A **snapshot** is a restore point for one block. A project **backup** is a complete copy of
one project database. A block or plan **export** is portable JSON for copying designs, not
complete recovery.

## What PyOps calculates

Given the goals, recipes, boundaries, buildings, fuels, modules, and constraints you
choose, PyOps calculates rates, fractional machine requirements, item and fluid flows,
power, pollution, and whole-factory balance. It can solve cyclic production systems that
are awkward to expand by hand.

The result is a sizing calculation, not an automatically optimized factory. A solved block
means the equations are consistent with the choices you entered; it does not mean the
chain is cheapest, shortest, or best for your playthrough.

## Current modelling boundaries

- PyOps does not automatically choose the best recipe chain or decide where block
  boundaries belong.
- Machine counts are mathematical requirements and may be fractional. Round and build
  according to the operating margin you want.
- Factory shortages and surpluses are planning signals. PyOps does not create missing
  supplier blocks automatically.
- Belt and inserter/loaders estimates use the selected logistics settings. Pipe-network
  throughput and layout are not simulated.
- Spatial layout, train schedules, circuit behavior, and construction time are outside the
  production solver.
- Live save state and in-game actions require the Companion mod and UDP bridge. The core
  planner remains available without them.
- Assistant access currently requires OpenRouter. Model answers and proposals still need
  review before they become part of the plan or run in the game.
- The Linux `.deb` package requires manual updates; use the AppImage for in-app updates.

When a boundary affects the decision, record it in a task or note beside the plan rather
than assuming the solver models it.
