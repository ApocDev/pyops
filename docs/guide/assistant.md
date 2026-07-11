---
title: Use the Assistant
description: Ask project-aware planning questions and review proposed blocks or changes before applying them.
outline: [2, 3]
---

# Use the Assistant

The Assistant answers planning questions using the active project's Factorio data and
saved blocks. Use it to compare recipe chains, decide whether to import or build a good,
find consumers for a byproduct, audit the factory, or draft production blocks.

## Configure access

Open **Settings → Planning** and find the **Assistant** card.

::: info OpenRouter is the only supported provider connection
PyOps currently sends Assistant requests through [OpenRouter](https://openrouter.ai/).
Create and manage a key on the [OpenRouter API Keys page](https://openrouter.ai/settings/keys),
then use the [OpenRouter model catalog](https://openrouter.ai/models) to compare available
models and pricing.

An OpenAI, Anthropic, Google, or other direct provider key is not accepted. To use one of
those providers' models, select its OpenRouter model and authenticate with an OpenRouter
key.
:::

1. Enter an OpenRouter API key.
2. Choose the default model.
3. Open **Assistant** from the main navigation.

The API key belongs to the PyOps app configuration, not an individual project, and is not
included in project backups. Prompts, tool results, and conversation context are sent to
OpenRouter and the selected model provider to generate a response.

::: warning Review sensitive project context before sending
The Assistant can read planning data from the active project and may include relevant tool
results in a model request. Do not ask it to inspect or repeat information that should not
leave the computer.
:::

## Choose a model and reasoning effort

The model saved under **Settings → Planning → Assistant** is the default for conversations
without an override. In a conversation, select the model name in the input bar to:

- choose one of PyOps' curated OpenRouter aliases;
- enter a **Custom OpenRouter id…** from the model catalog;
- make the active model the app default;
- clear the conversation override and return to the default.

Aliases ending in `-latest` follow OpenRouter's corresponding model family. A concrete
model ID keeps that exact selection until you change it.

The **Auto / Low / Medium / High** control sets reasoning effort for the conversation.
PyOps enables only levels advertised by the selected model. **Auto** leaves the decision
to the model and provider.

::: tip Start with a curated model
Custom model IDs are useful for experimentation, but models differ in tool-calling and
reasoning behavior. Return to a curated model when a custom model cannot complete PyOps
tool calls reliably.
:::

## Understand usage and cost

OpenRouter bills the API key according to the selected model's input, output, and reasoning
token prices. PyOps does not add a separate Assistant subscription or markup.

One visible answer can involve several model steps because the Assistant may inspect the
project with tools before responding. Conversation titles, manual context compaction,
**Prioritise**, and task enhancement also use the configured model. Consequently, the cost
of a planning request is not necessarily one simple completion.

To control spending:

- compare per-token prices in the [OpenRouter model catalog](https://openrouter.ai/models);
- create a dedicated PyOps key and set a spending limit on the
  [OpenRouter API Keys page](https://openrouter.ai/settings/keys);
- use lower reasoning effort for straightforward lookups;
- start a focused conversation or compact older messages when the context ring becomes
  large;
- use a smaller model for routine recipe questions and a stronger model for multi-block
  planning.

The context ring reports conversation usage, not monetary cost. Check OpenRouter for
actual account usage and charges.

## Ask a project-aware question

Ask for a concrete decision and provide the operational constraint that matters. Examples:

- `Which unsourced import should I plan next, and why?`
- `Compare the available recipes for this block's Coal demand.`
- `Find a consumer for the Ash surplus without changing any blocks.`
- `Audit Coherence and summarize the highest-impact shortages.`

The Assistant can search goods and recipes, inspect inputs and machines, size recipes,
read blocks, run the factory and Coherence analyses, and check TURD consistency. With the
Companion mod connected, it can also inspect approved live-game context.

<AppScreenshot
  src="/images/assistant-planning-question.png"
  alt="The PyOps Assistant recommending Soil as the next unsourced import for the five-block tutorial factory"
  caption="The answer is grounded in the active project: it compares the actual unsourced imports, identifies the 10-per-second Soil demand, and separately flags existing linked shortages."
/>

Select the collapsed **tool calls** row when you want to inspect how the answer was
grounded. Item, fluid, and recipe references render as localized icon chips; hover them for
details.

## Review proposals before applying them

The Assistant does not silently edit the project. Write operations appear as proposal
cards:

- **Draft a block** shows the goals, recipes, imports, byproducts, power, and suggested
  follow-up blocks. Select **Create block** to save it.
- **Draft a plan** presents several block cards for a larger production goal. Review the
  plan before creating its blocks.
- **Revise a block** shows rate and recipe changes against the saved block. Select
  **Apply update →** to persist them.
- A live-game Lua request shows the proposed code and requires **Run** before anything is
  executed in Factorio.

Check recipe availability, TURD choices, boundary flows, and machine selections on every
proposal. The Assistant can make a well-grounded suggestion that still differs from the
factory you intend to build.

## Manage conversations

Select **New** to start an independent chat. Each conversation can override its model and
reasoning effort from the input bar.

- The numbered context ring shows how much of the model's context window is occupied.
  Select it to summarize older messages when the conversation becomes large.
- Hover a message to edit, retry, or branch from that point.
- A running conversation remains active while you visit another PyOps page; the navigation
  shows a running indicator.

Deleting a conversation is permanent and is not part of the project undo history.

## Troubleshoot the Assistant

### “No OpenRouter API key set”

Open **Settings → Planning**, enter a key under **Assistant (AI)**, and select **Save**. If
`OPENROUTER_API_KEY` is set in the environment, it takes priority over the stored value.

### A request fails immediately

Check that the OpenRouter key is active, has available credit, and permits the selected
model. Then try a curated model. A custom model may be unavailable or may not support the
tool behavior required by the request.

### The model selector ignores the saved default

A conversation-level override takes priority over the stored default. Select the model
menu and **Clear override**. If `PYOPS_AGENT_MODEL` is set in the environment, that value
wins for every conversation and the UI cannot override it.

### Reasoning levels are unavailable

The selected model does not advertise OpenRouter reasoning-effort support. Leave the
control on **Auto** or choose a compatible model.

### A conversation stops without a final answer

Select **Continue** on the warning shown beneath the partial turn. If it stops repeatedly,
start a focused conversation, reduce the requested scope, or choose a model with stronger
tool-calling behavior.

### The answer uses stale game information

Select **pull from game** under **Settings → In-game link**, then ask again. The Assistant's
project tools and live-game tools are separate; specify that live state matters when the
answer should reflect the running save.
