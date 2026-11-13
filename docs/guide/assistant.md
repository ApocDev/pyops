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

Open **Settings → Planning** and find the **Assistant (AI)** card. Under **Provider**,
choose where Assistant requests go:

- **OpenRouter** sends requests to [OpenRouter](https://openrouter.ai/) with an OpenRouter
  API key. This is the default.
- **OpenAI-compatible** sends requests to any server that implements the OpenAI Chat
  Completions API, such as a [LiteLLM](https://docs.litellm.ai/) gateway, vLLM, or Ollama.

### Use OpenRouter

1. Select **OpenRouter**.
2. Enter a key from the [OpenRouter API Keys page](https://openrouter.ai/settings/keys) and
   select **Save**.
3. Optionally enter a default **Model** from the
   [OpenRouter model catalog](https://openrouter.ai/models). Leave it empty to use PyOps'
   default.

An OpenAI, Anthropic, or Google key does not work in this mode. To use those providers'
models, select their OpenRouter model IDs, or point **OpenAI-compatible** at a gateway that
holds those keys.

### Use an OpenAI-compatible endpoint

1. Select **OpenAI-compatible**.
2. Enter the **Endpoint URL**, including the API version path, for example
   `https://gateway.example/v1`, and select **Save**. PyOps appends `/chat/completions` and
   `/models` to it.
3. Enter the **Endpoint API key** if the server requires one and select **Save**. PyOps
   sends it as a bearer token. A local server without authentication needs no key.
4. Enter a default **Model** and select **Save**. When the endpoint lists its models, the
   field suggests them and the card shows how many chat models it found. Otherwise type the
   exact model ID the server expects.

The card shows a warning naming whatever is still missing. When it disappears, open
**Assistant** from the main navigation.

PyOps reads the endpoint's `/models` list for the model picker. On a LiteLLM gateway it also
reads `/model/info`, which reports each model's context window and reasoning support. A
server that lists no metadata still works. The context indicator then shows a token count
without a percentage, and reasoning effort stays on **Auto**.

Every request in this mode carries `x-ai-app: pyops` and `x-ai-session: <conversation id>`
headers, so a gateway can attribute usage to PyOps and to each conversation.

Keys and the provider choice belong to the PyOps app configuration, not an individual
project, and are not included in project backups. Prompts, tool results, and conversation
context are sent to the configured provider and the selected model to generate a response.

::: warning Review sensitive project context before sending
The Assistant can read planning data from the active project and may include relevant tool
results in a model request. Do not ask it to inspect or repeat information that should not
leave the computer.
:::

## Choose a model and reasoning effort

The model saved under **Settings → Planning → Assistant (AI)** is the default for
conversations without an override. Each provider keeps its own default. In a conversation,
select the model name in the input bar to:

- choose from the list: PyOps' curated OpenRouter aliases, or the models your
  OpenAI-compatible endpoint lists;
- enter a **Custom model id…**;
- make the active model the app default;
- clear the conversation override and return to the default.

Aliases ending in `-latest` follow OpenRouter's corresponding model family. A concrete
model ID keeps that exact selection until you change it.

The **Auto / Low / Medium / High** control sets reasoning effort for the conversation.
PyOps enables only levels advertised by the selected model. **Auto** leaves the decision
to the model and provider. On an OpenAI-compatible endpoint, PyOps sends the choice as the
`reasoning_effort` parameter.

::: tip Start with a curated model
Custom model IDs are useful for experimentation, but models differ in tool-calling and
reasoning behavior. Return to a curated model when a custom model cannot complete PyOps
tool calls reliably.
:::

## Understand usage and cost

The provider bills by the selected model's input, output, and reasoning tokens. PyOps does
not add a separate Assistant subscription or markup.

One visible answer can involve several model steps because the Assistant may inspect the
project with tools before responding. Conversation titles, manual context compaction,
**Prioritize**, and task enhancement also use the configured model. Consequently, the cost
of a planning request is not necessarily one simple completion.

Hover the context ring to see the last turn's cost, summed over all its steps. OpenRouter
reports a cost for every request, and so does a LiteLLM gateway that routes to OpenRouter.
When a provider reports no cost, the tooltip says **unknown** instead of showing $0. Check
the provider's dashboard for account totals.

To control spending:

- compare per-token prices in the [OpenRouter model catalog](https://openrouter.ai/models)
  or your gateway's model list;
- use a dedicated key with a spending limit, such as an OpenRouter key from the
  [OpenRouter API Keys page](https://openrouter.ai/settings/keys) or a LiteLLM virtual key;
- use lower reasoning effort for straightforward lookups;
- start a focused conversation or compact older messages when the context ring becomes
  large;
- use a smaller model for routine recipe questions and a stronger model for multi-block
  planning.

## Ask a project-aware question

Ask for a concrete decision and provide the operational constraint that matters. Examples:

- `Which unsourced import should I plan next, and why?`
- `Compare the available recipes for this block's Coal demand.`
- `Find a consumer for the Ash surplus without changing any blocks.`
- `Audit Factory connections and summarize the highest-impact shortages.`

The Assistant can search goods and recipes, inspect inputs and machines, size recipes,
read blocks, run the Factory Overview and Connections analyses, and check TURD consistency. With the
Companion mod connected, it can also inspect approved live-game context.

<AppScreenshot
  src="/images/assistant-planning-question.png"
  alt="The PyOps Assistant comparing the three Arqad TURD upgrade choices from the active project"
  caption="The answer is grounded in synced game data: it inspects the real mutually exclusive choices, explains their recipe and productivity effects, and recommends one for the stated goal."
/>

Select the collapsed **tool calls** row when you want to inspect how the answer was
grounded. Item, fluid, and recipe references render as localized icon chips; hover them for
details.

## Ask from any page

Select **Ask** in the top bar, or press <kbd>Ctrl</kbd>+<kbd>.</kbd> (<kbd>Command</kbd>+<kbd>.</kbd>
on macOS), to open the Assistant in a panel on the right. The page narrows to make room
and stays usable, so you can keep editing a block while you ask about it. On a phone the
panel fills the screen. Press the same key again, or select the close button, to hide it.

The panel shows the same conversations as the **Assistant** page:

- the chat title opens a list of saved chats;
- **+** starts a new chat;
- the expand button opens the current chat on the full **Assistant** page.

When the page is focused on something, a chip above the input names it, and your question
is sent with it. Then "why does this need so much power?" needs no restating:

| Page           | Context                         |
| -------------- | ------------------------------- |
| A block        | That block                      |
| Explore search | The selected item or fluid      |
| TURD           | The most recently expanded TURD |
| Tasks          | The selected task               |

Select the chip's **×** to ask without it. The context is a hint, not a limit: you can
still ask about anything. Each message sent from the panel shows the page it was asked
from above it.

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

- The numbered context ring shows how much of the model's context window is occupied. If
  the endpoint doesn't report the window, it shows a token count instead. Select it to
  summarize older messages when the conversation becomes large.
- Hover a message to edit, retry, or branch from that point.
- A running conversation remains active while you visit another PyOps page; the navigation
  shows a running indicator.

Deleting a conversation is permanent and is not part of the project undo history.

## Troubleshoot the Assistant

### The input bar says the Assistant can't respond

The warning names the missing setting: an OpenRouter API key, an endpoint URL, or a model
for the OpenAI-compatible endpoint. Open **Settings → Planning**, fill it in under
**Assistant (AI)**, and select **Save**. Environment variables take priority over stored
values; see [Advanced configuration](/reference/advanced-configuration).

### A request fails immediately

For OpenRouter, check that the key is active, has available credit, and permits the
selected model. For an OpenAI-compatible endpoint, check that the server is reachable and
the model ID is one it serves. A LiteLLM gateway rejects models outside its configured list
with HTTP 400. Then try a curated or listed model. A custom model may be unavailable or may
not support the tool behavior required by the request.

### The model selector ignores the saved default

A conversation-level override takes priority over the stored default. Select the model
menu and **Clear override**. If `PYOPS_AGENT_MODEL` is set in the environment, that value
wins for every conversation and the UI cannot override it.

### Reasoning levels are unavailable

The selected model does not advertise reasoning-effort support, or the OpenAI-compatible
endpoint doesn't report model metadata. Leave the control on **Auto** or choose a
compatible model.

### A conversation stops without a final answer

Select **Continue** on the warning shown beneath the partial turn. If it stops repeatedly,
start a focused conversation, reduce the requested scope, or choose a model with stronger
tool-calling behavior.

### The answer uses stale game information

Select **pull from game** under **Settings → In-game link**, then ask again. The Assistant's
project tools and live-game tools are separate; specify that live state matters when the
answer should reflect the running save.
