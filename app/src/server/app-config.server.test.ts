import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_MODEL,
  providerProblemFrom,
  resolveModelFrom,
  resolveProviderFrom,
} from "./app-config.server.ts";

const compatStored = {
  aiProvider: "openai-compatible" as const,
  openaiCompatibleBaseUrl: "https://gateway.test/v1/",
  openaiCompatibleApiKey: "stored-key",
  openaiCompatibleModel: "deepseek/deepseek-v4.1-flash",
};

describe("resolveProviderFrom", () => {
  it("defaults to OpenRouter with the stored key", () => {
    expect(resolveProviderFrom({}, { openrouterApiKey: "or-key" })).toEqual({
      kind: "openrouter",
      apiKey: "or-key",
    });
  });

  it("uses the stored OpenAI-compatible endpoint and trims the trailing slash", () => {
    expect(resolveProviderFrom({}, compatStored)).toEqual({
      kind: "openai-compatible",
      baseUrl: "https://gateway.test/v1",
      apiKey: "stored-key",
    });
  });

  it("lets env win for the provider, URL, and key", () => {
    const p = resolveProviderFrom(
      {
        PYOPS_AI_PROVIDER: "openai-compatible",
        PYOPS_OPENAI_COMPATIBLE_BASE_URL: "http://localhost:4000/v1",
        PYOPS_OPENAI_COMPATIBLE_API_KEY: "env-key",
      },
      { ...compatStored, aiProvider: "openrouter" },
    );
    expect(p).toEqual({
      kind: "openai-compatible",
      baseUrl: "http://localhost:4000/v1",
      apiKey: "env-key",
    });
  });

  it("ignores an unknown provider name from env or storage", () => {
    expect(resolveProviderFrom({ PYOPS_AI_PROVIDER: "bogus" }, {}).kind).toBe("openrouter");
    expect(resolveProviderFrom({}, { aiProvider: "bogus" as never }).kind).toBe("openrouter");
  });
});

describe("resolveModelFrom", () => {
  it("keeps a separate default per provider", () => {
    const stored = { ...compatStored, model: "openai/gpt-5.5" };
    expect(resolveModelFrom({}, stored).model).toBe("deepseek/deepseek-v4.1-flash");
    expect(resolveModelFrom({}, { ...stored, aiProvider: "openrouter" }).model).toBe(
      "openai/gpt-5.5",
    );
  });

  it("falls back to DEFAULT_MODEL only for OpenRouter", () => {
    expect(resolveModelFrom({}, {}).model).toBe(DEFAULT_MODEL);
    expect(resolveModelFrom({}, { aiProvider: "openai-compatible" }).model).toBe("");
  });

  it("orders env over the conversation override over the stored default", () => {
    expect(resolveModelFrom({}, compatStored, "local/qwen3:0.6b")).toMatchObject({
      model: "local/qwen3:0.6b",
      fromConversation: true,
    });
    expect(resolveModelFrom({ PYOPS_AGENT_MODEL: "env/model" }, compatStored, "x")).toMatchObject({
      model: "env/model",
      fromEnv: true,
    });
  });
});

describe("providerProblemFrom", () => {
  it("is null once the active provider is configured", () => {
    expect(providerProblemFrom({}, { openrouterApiKey: "k" })).toBeNull();
    expect(providerProblemFrom({}, compatStored)).toBeNull();
    // A local endpoint may need no key.
    expect(providerProblemFrom({}, { ...compatStored, openaiCompatibleApiKey: undefined })).toBe(
      null,
    );
  });

  it("accepts a conversation's model pick in place of a default model", () => {
    const noDefault = { ...compatStored, openaiCompatibleModel: undefined };
    expect(providerProblemFrom({}, noDefault, "local/qwen3:0.6b")).toBeNull();
    expect(providerProblemFrom({}, noDefault, "  ")).toMatch(/No model/);
  });

  it("names what is missing", () => {
    expect(providerProblemFrom({}, {})).toMatch(/OpenRouter API key/);
    expect(providerProblemFrom({}, { aiProvider: "openai-compatible" })).toMatch(/endpoint URL/);
    expect(providerProblemFrom({}, { ...compatStored, openaiCompatibleModel: undefined })).toMatch(
      /No model/,
    );
  });
});
