/**
 * Model list and metadata for an OpenAI-compatible endpoint, read from its
 * `GET /models` and, when the server answers it, LiteLLM's `GET /model/info`.
 * Cached in memory per endpoint (base URL + key), like openrouter-models.ts.
 *
 * Plain OpenAI-compatible servers return only ids from `/models`. Then the model
 * picker still lists them, but context window and reasoning support stay unknown
 * and the UI hides the gauge's percentage and the reasoning control. LiteLLM adds
 * `max_input_tokens` and `mode` to `/models`, and `/model/info` reports
 * `supports_reasoning` and the accepted OpenAI parameters. `reasoning` here means
 * the model accepts `reasoning_effort`: decided by the parameter list when one is
 * given, else by `supports_reasoning`.
 */

export type Endpoint = { baseUrl: string; apiKey: string | undefined };

export type EndpointModel = {
  id: string;
  contextWindow: number | null;
  reasoning: boolean;
};

type RawModel = { id?: string; mode?: string | null; max_input_tokens?: number | null };
type RawModelInfo = {
  model_name?: string;
  model_info?: {
    mode?: string | null;
    max_input_tokens?: number | null;
    supports_reasoning?: boolean | null;
    supported_openai_params?: string[] | null;
  } | null;
};

const TTL_MS = 10 * 60 * 1000; // endpoint catalogs are small and can change at any time
const RETRY_MS = 30 * 1000; // after a failed fetch, so a down endpoint isn't hit on every read
const FETCH_TIMEOUT_MS = 5000;

type Cache = {
  models: EndpointModel[];
  fetchedAt: number;
  failedAt: number;
  inflight: Promise<void> | null;
};
const caches = new Map<string, Cache>();
const cacheKey = (e: Endpoint) => `${e.baseUrl}\n${e.apiKey ?? ""}`;

async function getJson<T>(e: Endpoint, path: string): Promise<T> {
  const res = await fetch(`${e.baseUrl}${path}`, {
    headers: {
      accept: "application/json",
      ...(e.apiKey ? { authorization: `Bearer ${e.apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Merge `/models` with `/model/info` into chat-capable models. Entries whose
 * `mode` says they are not chat models (image, audio, embedding) are dropped;
 * entries without a mode are kept, since plain servers don't report one. */
export function mergeModelLists(models: RawModel[], info: RawModelInfo[]): EndpointModel[] {
  const infoById = new Map(info.flatMap((i) => (i.model_name ? [[i.model_name, i]] : [])));
  return models.flatMap((m) => {
    if (!m.id) return [];
    const extra = infoById.get(m.id)?.model_info;
    const mode = m.mode ?? extra?.mode;
    if (mode && mode !== "chat") return [];
    // An explicit accepted-parameter list is authoritative for effort support;
    // `supports_reasoning` alone doesn't mean the effort is configurable.
    const params = extra?.supported_openai_params;
    return [
      {
        id: m.id,
        contextWindow: m.max_input_tokens || extra?.max_input_tokens || null,
        reasoning: params ? params.includes("reasoning_effort") : !!extra?.supports_reasoning,
      },
    ];
  });
}

async function refresh(e: Endpoint, cache: Cache): Promise<void> {
  const models = await getJson<{ data?: RawModel[] }>(e, "/models");
  // `/model/info` is a LiteLLM extension; other servers 404 it.
  const info = await getJson<{ data?: RawModelInfo[] }>(e, "/model/info").catch(() => ({
    data: [],
  }));
  cache.models = mergeModelLists(models.data ?? [], info.data ?? []);
  cache.fetchedAt = Date.now();
}

/** Load (or refresh) an endpoint's catalog. De-dupes concurrent fetches and
 * never throws: a failed fetch leaves the previous list (or none) in place and
 * waits RETRY_MS before trying again. */
export async function ensureEndpointModelsLoaded(e: Endpoint): Promise<void> {
  const key = cacheKey(e);
  let cache = caches.get(key);
  if (!cache) {
    cache = { models: [], fetchedAt: 0, failedAt: 0, inflight: null };
    caches.set(key, cache);
  }
  const now = Date.now();
  if (cache.fetchedAt && now - cache.fetchedAt < TTL_MS) return;
  if (now - cache.failedAt < RETRY_MS) return;
  const c = cache;
  c.inflight ??= refresh(e, c)
    .catch((err) => {
      c.failedAt = Date.now();
      console.warn("[openai-compatible-models] catalog refresh failed:", (err as Error).message);
    })
    .finally(() => {
      c.inflight = null;
    });
  return c.inflight;
}

/** The cached chat models for an endpoint (empty until loaded or when the
 * endpoint lists none). Triggers a background refresh as a side effect. */
export function endpointModels(e: Endpoint): EndpointModel[] {
  void ensureEndpointModelsLoaded(e);
  return caches.get(cacheKey(e))?.models ?? [];
}
