/**
 * Model metadata for the active assistant provider: OpenRouter's public catalog
 * (openrouter-models.ts) or the configured OpenAI-compatible endpoint's own list
 * (openai-compatible-models.ts). Callers ask here and never branch on provider.
 */
import { resolveProvider, type ResolvedProvider } from "./app-config.server.ts";
import * as compat from "./openai-compatible-models.ts";
import * as openrouter from "./openrouter-models.ts";

const endpointOf = (p: ResolvedProvider): compat.Endpoint | null =>
  p.kind === "openai-compatible" && p.baseUrl ? { baseUrl: p.baseUrl, apiKey: p.apiKey } : null;

const endpointModel = (e: compat.Endpoint, id: string | null | undefined) =>
  compat.endpointModels(e).find((m) => m.id === id?.trim());

/** Load the active provider's catalog. Never throws. */
export async function ensureModelsLoaded(): Promise<void> {
  const p = resolveProvider();
  if (p.kind === "openrouter") return openrouter.ensureModelsLoaded();
  const e = endpointOf(p);
  if (e) await compat.ensureEndpointModelsLoaded(e);
}

/** A model's context window in tokens, or null when the endpoint doesn't report
 * one. OpenRouter always has an answer (live catalog, static table, fallback). */
export function modelContextWindow(modelId: string | null | undefined): number | null {
  const p = resolveProvider();
  if (p.kind === "openrouter") return openrouter.modelContextWindow(modelId);
  const e = endpointOf(p);
  return (e && endpointModel(e, modelId)?.contextWindow) || null;
}

/** Whether the model accepts a reasoning-effort setting. */
export function supportsReasoningEffort(modelId: string | null | undefined): boolean {
  const p = resolveProvider();
  if (p.kind === "openrouter") return openrouter.supportsReasoningEffort(modelId);
  const e = endpointOf(p);
  return !!(e && endpointModel(e, modelId)?.reasoning);
}

/** The effort levels a model advertises (empty when unknown). Endpoints don't
 * list levels, so the UI offers the standard low/medium/high when supported. */
export function supportedReasoningEfforts(modelId: string | null | undefined): string[] {
  const p = resolveProvider();
  return p.kind === "openrouter" ? openrouter.supportedReasoningEfforts(modelId) : [];
}

/** Model ids for the picker: the endpoint's chat models, or null for OpenRouter
 * (the client keeps its curated shortlist there). */
export function pickerModels(): string[] | null {
  const p = resolveProvider();
  if (p.kind === "openrouter") return null;
  const e = endpointOf(p);
  return e ? compat.endpointModels(e).map((m) => m.id) : [];
}
