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

import { APP_CONFIG_FILE } from "./paths.ts";

/** Default OpenRouter model when neither env nor app-config sets one. */
export const DEFAULT_MODEL = "~anthropic/claude-sonnet-latest";

const FILE = APP_CONFIG_FILE;

export type AppConfig = {
  active?: string; // the selected project id
  openrouterApiKey?: string;
  model?: string;
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

/** OpenRouter API key: env wins, else the stored value, else undefined. */
export function resolveApiKey(): { key: string | undefined; fromEnv: boolean } {
  const env = process.env.OPENROUTER_API_KEY;
  if (env) return { key: env, fromEnv: true };
  return { key: readAppConfig().openrouterApiKey, fromEnv: false };
}

/** Agent model: env wins, else the provided override, else the stored value, else
 * DEFAULT_MODEL. Env stays a hard deployment override; per-conversation model
 * picks only apply when PYOPS_AGENT_MODEL is unset. */
export function resolveModel(override?: string | null): {
  model: string;
  fromEnv: boolean;
  fromConversation: boolean;
} {
  const env = process.env.PYOPS_AGENT_MODEL;
  if (env) return { model: env, fromEnv: true, fromConversation: false };
  const picked = override?.trim();
  if (picked) return { model: picked, fromEnv: false, fromConversation: true };
  return { model: readAppConfig().model || DEFAULT_MODEL, fromEnv: false, fromConversation: false };
}
