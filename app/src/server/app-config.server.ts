/**
 * App-level config (cross-project): the user's AI account settings, which belong
 * to the person, not a mod-list project. Stored in `app-config.json` at the app
 * dir (sibling to the project db files), written 0600. Plaintext on purpose — a
 * key the app must use unattended can't be meaningfully encrypted at rest; an OS
 * keychain would be the only real option and is overkill for a local tool.
 *
 * Env always wins (deployment override); the stored value is the friendly default
 * for someone who didn't set env.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { APP_CONFIG_FILE } from "./paths.server.ts";

/** Default OpenRouter model when neither env nor app-config sets one. An
 * OpenAI-compatible endpoint has no default: its model list is the endpoint's own. */
export const DEFAULT_MODEL = "~anthropic/claude-sonnet-latest";

/** Which API the assistant talks to: OpenRouter, or any server that speaks the
 * OpenAI Chat Completions API (LiteLLM, vLLM, Ollama, ...). */
export const AI_PROVIDERS = ["openrouter", "openai-compatible"] as const;
export type AiProviderKind = (typeof AI_PROVIDERS)[number];

const FILE = APP_CONFIG_FILE;

export type AppConfig = {
  active?: string; // the selected project id
  aiProvider?: AiProviderKind;
  openrouterApiKey?: string;
  model?: string; // the OpenRouter default model
  // OpenAI-compatible endpoint (Settings → Planning). The base URL includes the
  // API version path, e.g. https://gateway.example/v1.
  openaiCompatibleBaseUrl?: string;
  openaiCompatibleApiKey?: string;
  openaiCompatibleModel?: string;
  factorySolverDebug?: boolean;
  // Factorio install paths (Settings → Game data). Env vars still win; see
  // factorio-paths.server.ts for the resolution order.
  factorioBin?: string;
  factorioDataDir?: string;
  factorioModsDir?: string;
};

export function readAppConfig(): AppConfig {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as AppConfig;
  } catch {
    /* fall through to empty */
  }
  return {};
}

export function writeAppConfig(patch: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...readAppConfig(), ...patch };
  // drop blanks so an unset key falls back to env/default rather than "" winning
  for (const k of Object.keys(next) as (keyof AppConfig)[]) {
    if (next[k] === "" || next[k] == null) delete next[k];
  }
  mkdirSync(dirname(FILE), { recursive: true }); // data dir may not exist yet
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  try {
    chmodSync(FILE, 0o600);
  } catch {
    /* best effort — e.g. Windows */
  }
  return next;
}

type Env = Record<string, string | undefined>;

export const isProviderKind = (v: unknown): v is AiProviderKind =>
  AI_PROVIDERS.some((p) => p === v);

/** The active assistant provider and its connection settings. Each value comes
 * from env when set (a deployment override), else from app-config. */
export type ResolvedProvider =
  | { kind: "openrouter"; apiKey: string | undefined }
  | { kind: "openai-compatible"; baseUrl: string | undefined; apiKey: string | undefined };

/** Pure provider resolution, so tests can pass env and stored config directly. */
export function resolveProviderFrom(env: Env, stored: AppConfig): ResolvedProvider {
  const envKind = env.PYOPS_AI_PROVIDER;
  const kind = isProviderKind(envKind)
    ? envKind
    : isProviderKind(stored.aiProvider)
      ? stored.aiProvider
      : "openrouter";
  if (kind === "openrouter") {
    return { kind, apiKey: env.OPENROUTER_API_KEY || stored.openrouterApiKey };
  }
  const baseUrl = env.PYOPS_OPENAI_COMPATIBLE_BASE_URL || stored.openaiCompatibleBaseUrl;
  return {
    kind,
    baseUrl: baseUrl?.trim().replace(/\/+$/, "") || undefined,
    apiKey: env.PYOPS_OPENAI_COMPATIBLE_API_KEY || stored.openaiCompatibleApiKey,
  };
}

export const resolveProvider = () => resolveProviderFrom(process.env, readAppConfig());

/** Pure model resolution: env wins, else the conversation override, else the
 * active provider's stored default, else DEFAULT_MODEL for OpenRouter ("" for an
 * OpenAI-compatible endpoint, which has no universal default). Env stays a hard
 * deployment override; per-conversation picks only apply when PYOPS_AGENT_MODEL
 * is unset. */
export function resolveModelFrom(
  env: Env,
  stored: AppConfig,
  override?: string | null,
): { model: string; fromEnv: boolean; fromConversation: boolean } {
  if (env.PYOPS_AGENT_MODEL) {
    return { model: env.PYOPS_AGENT_MODEL, fromEnv: true, fromConversation: false };
  }
  const picked = override?.trim();
  if (picked) return { model: picked, fromEnv: false, fromConversation: true };
  const model =
    resolveProviderFrom(env, stored).kind === "openrouter"
      ? stored.model || DEFAULT_MODEL
      : stored.openaiCompatibleModel || "";
  return { model, fromEnv: false, fromConversation: false };
}

/** Agent model for the active provider. See resolveModelFrom for the order. */
export const resolveModel = (override?: string | null) =>
  resolveModelFrom(process.env, readAppConfig(), override);

/** Why the assistant can't run with the current settings, as a user-facing
 * message, or null when it is ready. `modelOverride` is the conversation's own
 * model pick, which satisfies the model requirement on its own. */
export function providerProblemFrom(
  env: Env,
  stored: AppConfig,
  modelOverride?: string | null,
): string | null {
  const p = resolveProviderFrom(env, stored);
  if (p.kind === "openrouter") {
    return p.apiKey
      ? null
      : "No OpenRouter API key. Set one in Settings → Planning, or via the OPENROUTER_API_KEY env var.";
  }
  if (!p.baseUrl) {
    return "No OpenAI-compatible endpoint URL. Set one in Settings → Planning, or via the PYOPS_OPENAI_COMPATIBLE_BASE_URL env var.";
  }
  if (!resolveModelFrom(env, stored, modelOverride).model) {
    return "No model set for the OpenAI-compatible endpoint. Pick one in Settings → Planning, or via the PYOPS_AGENT_MODEL env var.";
  }
  return null;
}

export const providerProblem = (modelOverride?: string | null) =>
  providerProblemFrom(process.env, readAppConfig(), modelOverride);
