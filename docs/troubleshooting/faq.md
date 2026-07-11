---
title: Frequently asked questions
description: Short answers about requirements, connectivity, planning behavior, sharing, and local data.
outline: [2, 3]
---

# Frequently asked questions

## Requirements and connectivity

### Does PyOps require Factorio?

Game-data sync requires a local Factorio 2.1 installation because PyOps reads the exact
recipes and prototypes produced by that installation's enabled mods. After a project has
synced reference data, ordinary planning does not require Factorio to be running.

### Is the Companion mod required?

No. It adds live save synchronization, production and building statistics, the in-game
panel, and in-game actions. Blocks, Factory, Coherence, exploration, tasks, backups, and
project-aware Assistant tools work without it. See
[Use PyOps without the Companion mod](../guide/in-game-link#use-pyops-without-the-companion-mod).

### Does the core planner require internet access?

No. Planning and data sync are local. Internet access is needed to download releases,
check for updates, open external links, and use the OpenRouter-backed Assistant.

### Can I plan more than one save or mod set?

Yes. Create a separate project and sync it from the appropriate Factorio mod set. Each
project keeps its own reference data and plan. Confirm the active project before syncing,
because the sync updates that project.

## Planning behavior

### Why does PyOps leave ingredients as imports?

An import is an explicit block boundary, not an error. Select the good and choose a recipe
when it belongs inside the current block, or create a supplier block when it should be a
separate production unit. Factory and Coherence show whether other blocks cover the rate.

### Why is a machine count fractional?

The solver reports the exact capacity required at the selected speed and module settings.
A requirement of `2.4` means two machines are insufficient at full demand; the physical
build normally needs three or another capacity adjustment.

### Does “solved” mean the factory is complete?

No. It means that one block is mathematically consistent. Open Factory and Coherence to
check cross-block shortages, surpluses, buildings, power, and other whole-plan results.

### Will PyOps choose the best recipe automatically?

No. Recipe selection is deliberate so the result reflects technology, TURD choices,
byproducts, available buildings, and the factory you intend to operate. PyOps sizes and
audits those choices.

## Data and sharing

### Where are my projects stored?

Open **Settings → Game data → Storage location**. The displayed path is the source of truth
for that running installation. See [Settings and storage](../reference/settings-and-storage).

### Is an exported JSON file a backup?

It is a portable copy of one block or a set of blocks, not a complete project. Use
**Download “project”** under **Settings → Backup & share** for recovery or migration.

### Does a project backup contain my OpenRouter key?

No. The key is app-level configuration and is intentionally separate from project
databases and block exports.

### Can an imported plan use recipes from a different mod set?

PyOps imports the block definition and marks references that do not exist in the receiving
project. Review and replace missing goods, recipes, machines, or other choices before
relying on the result.

## Assistant

### Can I use an OpenAI or Anthropic API key directly?

No. PyOps currently connects through OpenRouter only. You can select models from those
providers through OpenRouter, using an OpenRouter API key.

### Does the Assistant change blocks automatically?

No. Draft and revision tools produce proposal cards. You decide whether to create or apply
them. Proposed live-game Lua also requires an explicit **Run** action.
