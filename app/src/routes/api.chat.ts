import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import {
  AGENT_SYSTEM,
  MAX_STEPS,
  agentTools,
  getModel,
  reasoningProviderOptions,
} from "#/server/agent.ts";
import { resolveApiKey } from "#/server/app-config.server.ts";
import { generateConversationTitle } from "#/server/conversation-title.server.ts";
import * as conv from "#/db/conversations.server.ts";
import * as q from "#/db/queries.server.ts";
import {
  finishAssistantRun,
  recordAssistantStream,
  resumeAssistantRun,
  startAssistantRun,
  stopAssistantRun,
} from "#/server/assistant-run-store.ts";
import { compactMessagesForContext } from "#/server/conversation-compaction.ts";

const toStored = (messages: UIMessage[]) =>
  messages.map((m) => ({ id: m.id, role: m.role, parts: JSON.stringify(m.parts) }));

const fromStored = (messages: { id: string; role: string; parts: string }[]): UIMessage[] =>
  messages.map((m) => ({ id: m.id, role: m.role, parts: JSON.parse(m.parts) }) as UIMessage);

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("stream");
        return id ? resumeAssistantRun(id) : new Response(null, { status: 204 });
      },
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          id?: string;
          messages?: UIMessage[];
          action?: "stop";
          assistantMessage?: UIMessage;
        };
        if (body.action === "stop" && body.id) {
          return Response.json(stopAssistantRun(body.id, body.assistantMessage));
        }

        if (!resolveApiKey().key) {
          return new Response(
            "No OpenRouter API key. Set one in Settings → Assistant, or via the OPENROUTER_API_KEY env var.",
            { status: 500 },
          );
        }
        const id = body.id;
        let messages = body.messages ?? [];
        if (!id) return new Response("Missing chat id.", { status: 400 });

        conv.saveConversation(id, toStored(messages));
        let conversation = conv.getConversation(id);
        if (conversation) {
          const compacted = await compactMessagesForContext(
            conversation.messages,
            conversation.model,
            {
              realUsedTokens: conversation.usage.totalTokens,
              lastModelId: conversation.usage.modelId,
            },
          );
          if (compacted.compacted) {
            conv.saveConversation(id, compacted.messages, conversation.title ?? undefined);
            messages = fromStored(compacted.messages);
            conversation = conv.getConversation(id);
          }
        }
        const { streamId, abortSignal } = startAssistantRun(id);

        // Inject the current planning horizon so the agent honours now/future mode.
        const h = q.getResearchHorizon();
        const horizonNote =
          `\n\n## Current planning horizon: ${h.mode.toUpperCase()}\n` +
          (h.mode === "now"
            ? `Plan with what the user can build RIGHT NOW. Use only recipes with buildableNow=true (research enabled/available within their science, and — for TURD recipes — the choice already ACTIVE). Do NOT use needs-research or turd 'blocked' recipes, and do NOT plan with a 'pickable' (unpicked) TURD branch: that choice is a near-permanent, factory-wide commitment, not a free swap, and a TURD is never required — there is always a base recipe. Instead, after finalizing the plan, call availableTurds with the plan's recipes and surface what it returns as a "TURD opportunities" section ("TURD X is available — option A would do …, B would do …"), as advice only, never applied. Available science packs: ${[...h.packs].join(", ") || "(none set — only start-enabled + researched techs count)"}.`
            : h.mode === "target"
              ? `Plan UP TO the tech tier of \`${h.target ?? "(unset)"}\`${h.targetTech ? ` (unlocked by tech '${h.targetTech}')` : ""}. Everything reachable by then is available — use only recipes with availableNow=true; pick the BEST available one, don't settle for a worse recipe. Recipes that need anything beyond this tier are OUT of horizon (their needsResearch packs aren't available) — do NOT use them. Science packs available up to this target: ${[...h.packs].join(", ") || "(none — target unset or unresolved)"}.`
              : `FUTURE planning — any recipe is fair game; just CALL OUT what must be unlocked (the science packs in needsResearch) or which TURD to select (turd.state 'pickable' = pick it; 'blocked' = requires a respec on that master).`);

        const result = streamText({
          model: getModel(conversation?.model),
          providerOptions: reasoningProviderOptions(
            conversation?.model,
            conversation?.reasoningEffort,
          ),
          system: AGENT_SYSTEM + horizonNote,
          messages: await convertToModelMessages(messages),
          tools: agentTools,
          abortSignal,
          stopWhen: stepCountIs(MAX_STEPS),
          onError: ({ error }) => console.error("[agent] stream error:", error),
          onFinish: ({ finishReason, steps, text, usage, response }) => {
            console.log(
              `[agent] finished: reason=${finishReason} steps=${steps.length} textLen=${text?.length ?? 0} tokens=${usage?.totalTokens ?? "?"} model=${response?.modelId ?? "?"}`,
            );
            // Persist the real OpenRouter token counts so compaction + the context
            // gauge run on actuals. The aggregate `usage` SUMS every tool step's
            // prompt (each step re-sends the whole context), so it wildly overcounts
            // the real context size — the LAST step's input+output is the true fill
            // (that request carried the entire conversation).
            const lastUsage = steps[steps.length - 1]?.usage;
            const inputTokens = lastUsage?.inputTokens ?? null;
            const outputTokens = lastUsage?.outputTokens ?? null;
            conv.recordTurnUsage(id, {
              inputTokens,
              outputTokens,
              totalTokens:
                inputTokens == null && outputTokens == null
                  ? null
                  : (inputTokens ?? 0) + (outputTokens ?? 0),
              modelId: response?.modelId ?? null,
            });
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: ({ messages: finished, isAborted }) => {
            conv.saveConversation(id, toStored(finished));
            if (!isAborted) void generateConversationTitle(id);
            finishAssistantRun(id, streamId);
          },
          consumeSseStream: ({ stream }) => recordAssistantStream(id, streamId, stream),
        });
      },
    },
  },
});
