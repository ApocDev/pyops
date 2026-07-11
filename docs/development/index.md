---
title: Development
description: Understand the PyOps architecture, data model, solver, integrations, design system, and release process.
outline: [2, 3]
---

# Development

This section describes the implementation and the contracts contributors must preserve.
For installation and product workflows, use the [user guide](../getting-started/).

## System guides

- [Architecture](./architecture) maps the TanStack application, SQLite projects, desktop
  shell, and Factorio mod.
- [Data pipeline](./data-pipeline) follows a game-data sync from Factorio dumps through
  normalization, synthesis, SQLite import, and icon-atlas generation.
- [Block solver](./solver) explains the HiGHS model, user-derived constraints, composed
  sub-blocks, effects, and factory-wide analysis.
- [Factorio bridge](./bridge) documents the localhost UDP protocol, live-state ownership,
  Companion mod, and development loop.
- [AI assistant](./ai-assistant) covers conversation persistence, context management,
  tool boundaries, proposal approval, OpenRouter, and the MCP surface.
- [Design system](./design) defines tokens, primitives, page anatomy, responsive behavior,
  and interaction states.
- [Desktop app and releases](./desktop) explains the Tauri shell, bundled server, platform
  packaging, release automation, signing, and self-update.

## Working in the repository

The root
[`AGENTS.md`](https://github.com/ApocDev/pyops/blob/main/AGENTS.md) is the contributor
runbook. It owns repository layout, Vite+ commands, verification expectations, code and UI
conventions, documentation maintenance, commits, and issue tracking.

Run application commands from `app/`:

```sh
vp install
vp check
vp test
vp dev
```

Run documentation commands from `docs/`:

```sh
vp install
vp check
vp run docs:dev
vp run docs:build
```

::: tip Use the owning guide
User-visible setup belongs in the user guide. This section should explain why a subsystem
works as it does, which files own it, and how to change and verify it safely.
:::
