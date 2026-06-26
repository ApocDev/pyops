export type ModelCapability = {
  contextWindow: number;
  reasoningEffort: boolean;
};

/** Static fallback table for when the live OpenRouter model list (see
 * server/openrouter-models.ts) is unavailable — offline, first call before the
 * fetch resolves, or an id the API doesn't list. The dynamic layer is the source
 * of truth; this just keeps the common models sane without a network round-trip. */
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  "~anthropic/claude-sonnet-latest": { contextWindow: 1_000_000, reasoningEffort: true },
  "~anthropic/claude-opus-latest": { contextWindow: 1_000_000, reasoningEffort: true },
  "~google/gemini-flash-latest": { contextWindow: 1_048_576, reasoningEffort: true },
  "~moonshotai/kimi-latest": { contextWindow: 262_142, reasoningEffort: true },
  "~openai/gpt-latest": { contextWindow: 1_050_000, reasoningEffort: true },
  "~openai/gpt-mini-latest": { contextWindow: 400_000, reasoningEffort: true },
  "moonshotai/kimi-k2.7-code": { contextWindow: 262_144, reasoningEffort: true },
  "openai/gpt-5.5": { contextWindow: 1_050_000, reasoningEffort: true },
  "openai/gpt-5.5-pro": { contextWindow: 1_050_000, reasoningEffort: true },
  "z-ai/glm-5.2": { contextWindow: 1_048_576, reasoningEffort: true },
  "openrouter/auto": { contextWindow: 128_000, reasoningEffort: true },
};

export const FALLBACK_CONTEXT_WINDOW = 128_000;

/** Static-table context window, or undefined if the id isn't in the table.
 * (`modelContextWindow` applies the fallback; this lets the dynamic layer tell
 * "known statically" from "unknown".) */
export function staticContextWindow(modelId: string | null | undefined): number | undefined {
  const id = modelId?.trim();
  return (id && MODEL_CAPABILITIES[id]?.contextWindow) || undefined;
}

export function modelContextWindow(modelId: string | null | undefined): number {
  return staticContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW;
}

export function supportsReasoningEffort(modelId: string | null | undefined): boolean {
  const id = modelId?.trim();
  return !!id && !!MODEL_CAPABILITIES[id]?.reasoningEffort;
}
