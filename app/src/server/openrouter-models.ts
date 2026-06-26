/**
 * Live OpenRouter model metadata (context window, reasoning support + efforts),
 * fetched from the public `/api/v1/models` catalogue and cached in-memory. This is
 * the source of truth for a model's real context window; the static table in
 * lib/model-capabilities.ts is only the offline fallback.
 *
 * Accessors are synchronous so existing call sites (reasoningProviderOptions,
 * compaction) don't have to become async: they read whatever is cached and kick
 * off a background refresh. The async paths (compaction, token-status) can `await
 * ensureModelsLoaded()` first when they want the freshest numbers.
 *
 * OpenRouter "~author/model-latest" aliases redirect to the newest concrete model
 * in a family and expose no context length of their own, so we resolve them to the
 * newest concrete id sharing the family prefix.
 */
import {
  FALLBACK_CONTEXT_WINDOW,
  staticContextWindow,
  supportsReasoningEffort as staticSupportsReasoning,
} from "../lib/model-capabilities.ts";

export type ModelMeta = {
  contextWindow: number;
  reasoning: boolean;
  efforts: string[];
};

type RawModel = {
  id: string;
  canonical_slug?: string;
  created?: number;
  context_length?: number;
  top_provider?: { context_length?: number | null } | null;
  supported_parameters?: string[] | null;
  reasoning?: { supported_efforts?: string[] | null } | null;
};

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — the catalogue changes slowly
const concrete = new Map<string, ModelMeta>();
let rawModels: RawModel[] = [];
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

function toMeta(m: RawModel): ModelMeta {
  const window = m.top_provider?.context_length || m.context_length || FALLBACK_CONTEXT_WINDOW;
  const params = m.supported_parameters ?? [];
  const efforts = m.reasoning?.supported_efforts ?? [];
  return {
    contextWindow: window,
    reasoning: params.includes("reasoning") || params.includes("reasoning_effort"),
    efforts: efforts.filter((e): e is string => typeof e === "string"),
  };
}

async function refresh(): Promise<void> {
  const res = await fetch(MODELS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: RawModel[] };
  const models = body.data ?? [];
  concrete.clear();
  for (const m of models) if (m.id) concrete.set(m.id, toMeta(m));
  rawModels = models;
  fetchedAt = Date.now();
}

/** Ensure the catalogue is loaded and reasonably fresh. Safe to call often: it
 * de-dupes concurrent fetches and no-ops while the cache is within its TTL. Never
 * throws — a failed fetch leaves the previous cache (or none) in place. */
export async function ensureModelsLoaded(): Promise<void> {
  if (concrete.size && Date.now() - fetchedAt < TTL_MS) return;
  if (!inflight) {
    inflight = refresh()
      .catch((err) => {
        console.warn("[openrouter-models] catalogue refresh failed:", (err as Error).message);
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Newest concrete model id sharing an alias's family prefix, e.g.
 * `~anthropic/claude-sonnet-latest` -> `anthropic/claude-sonnet-4.6`. */
function resolveAliasFamily(aliasId: string): string | undefined {
  const family = aliasId.replace(/^~/, "").replace(/-latest$/, "");
  let best: RawModel | undefined;
  for (const m of rawModels) {
    const id = m.id;
    if (id.startsWith("~")) continue;
    if (id === family || id.startsWith(`${family}-`) || id.startsWith(`${family}/`)) {
      if (!best || (m.created ?? 0) > (best.created ?? 0)) best = m;
    }
  }
  return best?.id;
}

/** Live metadata for a model id (concrete or `~…-latest` alias), or undefined if
 * not in the cache. Triggers a background refresh as a side effect. */
function liveMeta(modelId: string | null | undefined): ModelMeta | undefined {
  void ensureModelsLoaded();
  const id = modelId?.trim();
  if (!id) return undefined;
  const exact = concrete.get(id);
  if (exact) return exact;
  if (id.startsWith("~")) {
    const fam = resolveAliasFamily(id);
    if (fam) return concrete.get(fam);
  }
  return undefined;
}

/** A model's context window in tokens: live catalogue first, then the curated
 * static table (which has the `~…-latest` aliases), then the global fallback. */
export function modelContextWindow(modelId: string | null | undefined): number {
  return (
    liveMeta(modelId)?.contextWindow ?? staticContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW
  );
}

/** Whether a model advertises OpenRouter reasoning effort. Live catalogue first,
 * then the static table. */
export function supportsReasoningEffort(modelId: string | null | undefined): boolean {
  const live = liveMeta(modelId);
  if (live) return live.reasoning;
  return staticSupportsReasoning(modelId);
}

/** The reasoning effort levels a model accepts (empty if unknown/unsupported). */
export function supportedReasoningEfforts(modelId: string | null | undefined): string[] {
  return liveMeta(modelId)?.efforts ?? [];
}
