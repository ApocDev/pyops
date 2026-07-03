export type ModelCapability = {
  contextWindow: number;
  reasoningEffort: boolean;
};

/** Static fallback table for when the live OpenRouter model list (see
 * server/openrouter-models.ts) is unavailable — offline, first call before the
 * fetch resolves, or an id the API doesn't list. The dynamic layer is the source
 * of truth; this just keeps the common models sane without a network round-trip. */
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // Claude's 1M context is GA (since 2026-03) on the current Sonnet/Opus
  // generations these aliases resolve to: it is the DEFAULT window — no
  // `anthropic-beta: context-1m-…` header, no long-context surcharge. The old
  // `context-1m-2025-08-07` beta was retired 2026-04-30 (it only ever applied to
  // Sonnet 4/4.5, which stay at 200k). Nothing to send per-request, so 1M is the
  // honest usable size here; OpenRouter's live catalogue agrees. See #72.
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
