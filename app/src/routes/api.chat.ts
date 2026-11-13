import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import {
  AGENT_SYSTEM,
  MAX_STEPS,
  agentTools,
  getModel,
  reasoningProviderOptions,
  turnCost,
} from "#/server/agent.ts";
import { providerProblem } from "#/server/app-config.server.ts";
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
import { pageContextNote } from "#/server/page-context-note.ts";

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

        const id = body.id;
        let messages = body.messages ?? [];
        if (!id) return new Response("Missing chat id.", { status: 400 });
        // Validate against the conversation's own model pick, not just the app default.
        const problem = providerProblem(conv.getConversationModel(id));
        if (problem) return new Response(problem, { status: 500 });
        const shouldGenerateTitle = !messages.some((m) => m.role === "assistant");

        conv.syncConversation(id, toStored(messages));
        let conversation = conv.getConversation(id);
        if (conversation) {
          const compacted = await compactMessagesForContext(
            conversation.messages,
            conversation.model,
            {
              realUsedTokens: conversation.usage.totalTokens,
              lastModelId: conversation.usage.modelId,
              sessionId: id,
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
          model: getModel(conversation?.model, id),
          providerOptions: reasoningProviderOptions(
            conversation?.model,
            conversation?.reasoningEffort,
          ),
          instructions: AGENT_SYSTEM + horizonNote + pageContextNote(messages),
          messages: await convertToModelMessages(messages),
          // A compacted conversation starts with a server-written system message
          // holding the summary (see conversation-compaction.ts).
          allowSystemInMessages: true,
          tools: agentTools,
          abortSignal,
          stopWhen: isStepCount(MAX_STEPS),
          onError: ({ error }) => console.error("[agent] stream error:", error),
          onEnd: ({ finishReason, steps, finalStep }) => {
            const modelId = finalStep.response.modelId;
            console.log(
              `[agent] finished: reason=${finishReason} steps=${steps.length} textLen=${finalStep.text.length} tokens=${finalStep.usage.totalTokens ?? "?"} model=${modelId}`,
            );
            // Persist the real token counts so compaction + the context
            // gauge run on actuals. The aggregate `usage` SUMS every tool step's
            // prompt (each step re-sends the whole context), so it wildly overcounts
            // the real context size — the final step's input+output is the true fill
            // (that request carried the entire conversation).
            const inputTokens = finalStep.usage.inputTokens ?? null;
            const outputTokens = finalStep.usage.outputTokens ?? null;
            conv.recordTurnUsage(id, {
              inputTokens,
              outputTokens,
              totalTokens:
                inputTokens == null && outputTokens == null
                  ? null
                  : (inputTokens ?? 0) + (outputTokens ?? 0),
              modelId,
              costUsd: turnCost(steps),
            });
          },
        });

        return createUIMessageStreamResponse({
          stream: toUIMessageStream({
            stream: result.stream,
            tools: agentTools,
            originalMessages: messages,
            onEnd: ({ messages: finished, isAborted }) => {
              conv.syncConversation(id, toStored(finished));
              if (!isAborted && shouldGenerateTitle) void generateConversationTitle(id);
              finishAssistantRun(id, streamId);
            },
          }),
          consumeSseStream: ({ stream }) => recordAssistantStream(id, streamId, stream),
        });
      },
    },
  },
});
