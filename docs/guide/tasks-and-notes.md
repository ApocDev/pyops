---
title: Track tasks and notes
description: Keep project-scoped work, checklists, subtasks, links, and scratch notes beside the factory plan.
outline: [2, 3]
---

# Track tasks and notes

**Tasks** stores the work required to turn the plan into an operating factory. **Notes** is
a lightweight project scratchpad for calculations, decisions, and reminders. Both belong
to the active project and are included in its database backup.

## Create a task

1. Open **Tasks** from the main navigation.
2. Select **+ Task**.
3. Enter a title and markdown description.
4. Set the status to **Open**, **In progress**, **Done**, or **Closed**.
5. Add checklist entries under **Steps** and child work under **Subtasks**.

<AppScreenshot
  src="/images/tasks-planning-work.png"
  alt="A PyOps task named Automate Soil for planter boxes with an in-progress status, three steps, and one subtask"
  caption="Steps are a checklist inside one task. Subtasks are separate child tasks that can carry their own status, description, steps, and links."
/>

Use steps for the sequence within one piece of work. Use subtasks when a child needs its
own owner, status, description, or checklist. The task tree rolls both into the parent's
progress count.

## Link work to the factory

Under **Links**, attach relevant items, fluids, recipes, or blocks. A block link opens the
editor directly. Tasks captured from the in-game PyOps panel can also contain a map
position or entity; **go to** returns to that location when the Companion mod is connected.

Links keep titles concise. For example, a task named `Resolve the Ash shortage` can link
the Ash item, the Planter box consumer block, and the candidate disposal recipe instead of
repeating those details in its title.

## Filter and prioritize tasks

The status buttons above the task tree show or hide **Open**, **In progress**, **Done**, and
**Closed** work. An ancestor remains visible when one of its descendants matches the
filter.

Select **Prioritise** to ask the Assistant to rank open work. The resulting priority and
reason are advisory; they do not change task status or complete steps. This action requires
a configured Assistant model.

The wand beside a task title asks the Assistant to sharpen that task's title and
description. Review the result as project content, just as you would review an Assistant
planning answer.

## Use Notes as a scratchpad

Select the **Notes** tab, then **+ Note**. A note has a title and markdown body but no
workflow status or checklist. Use it for information that should remain available without
becoming work to complete.

Examples include:

- train throughput calculations;
- a reason for choosing one TURD branch;
- temporary measurements from the running factory;
- a compact construction or startup checklist that does not need task tracking.

Task and note edits synchronize with the in-game panel while the bridge is connected.
