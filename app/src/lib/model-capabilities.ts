export type ModelCapability = {
  contextWindow: number;
  reasoningEffort: boolean;
};

/** Static fallback table for when the live OpenRouter model list (see
 * server/openrouter-models.ts) is unavailable — offline, first call before the
 * fetch resolves, or an id the API doesn't list. The dynamic layer is the source
 * of truth; this just keeps the common models sane without a network round-trip. */
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // Claude's default window over the API is 200k; the 1M context is a beta we don't
  // request yet (no context-1m beta header), so 200k is the honest usable size.
  // Bump back to 1M once that beta is wired up — see the tracked follow-up issue.
  "~anthropic/claude-sonnet-latest": { contextWindow: 200_000, reasoningEffort: true },
  "~anthropic/claude-opus-latest": { contextWindow: 200_000, reasoningEffort: true },
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

/** Distinguishing tokens of a `~author/model-latest` alias, e.g.
 * "~anthropic/claude-opus-latest" → ["anthropic","claude","opus"]. */
function aliasTokens(aliasKey: string): string[] {
  return aliasKey
    .replace(/^~/, "")
    .replace(/-latest$/, "")
    .split(/[/-]/)
    .filter(Boolean);
}

/** Static-table context window, or undefined if the id isn't in the table.
 * (`modelContextWindow` applies the fallback; this lets the dynamic layer tell
 * "known statically" from "unknown".)
 *
 * Also matches the CONCRETE model id a turn actually ran on — OpenRouter reports
 * e.g. "anthropic/claude-4.8-opus-20260528" after resolving a `~…-latest` alias,
 * with the version interleaved — by treating an alias as matched when the id
 * contains all of its tokens (most-specific alias wins). Without this the window
 * collapses to the fallback the moment the first turn completes. */
export function staticContextWindow(modelId: string | null | undefined): number | undefined {
  const id = modelId?.trim();
  if (!id) return undefined;
  const exact = MODEL_CAPABILITIES[id]?.contextWindow;
  if (exact) return exact;
  const idTokens = new Set(id.split(/[/-]/).filter(Boolean));
  let best: { tokens: number; window: number } | undefined;
  for (const key of Object.keys(MODEL_CAPABILITIES)) {
    if (!key.startsWith("~")) continue;
    const toks = aliasTokens(key);
    if (toks.every((t) => idTokens.has(t)) && (!best || toks.length > best.tokens)) {
      best = { tokens: toks.length, window: MODEL_CAPABILITIES[key].contextWindow };
    }
  }
  return best?.window;
}

export function modelContextWindow(modelId: string | null | undefined): number {
  return staticContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW;
}

export function supportsReasoningEffort(modelId: string | null | undefined): boolean {
  const id = modelId?.trim();
  return !!id && !!MODEL_CAPABILITIES[id]?.reasoningEffort;
}
