import { describe, expect, it } from "vite-plus/test";
import { mergeModelLists } from "./openai-compatible-models.ts";

const info = (model_info: Record<string, unknown>) => [{ model_name: "m", model_info }];

describe("mergeModelLists reasoning-effort support", () => {
  it("trusts an explicit parameter list over supports_reasoning", () => {
    const [m] = mergeModelLists(
      [{ id: "m" }],
      info({ supports_reasoning: true, supported_openai_params: ["tools", "temperature"] }),
    );
    expect(m.reasoning).toBe(false);
  });

  it("offers effort when the list includes reasoning_effort", () => {
    const [m] = mergeModelLists(
      [{ id: "m" }],
      info({ supports_reasoning: false, supported_openai_params: ["reasoning_effort"] }),
    );
    expect(m.reasoning).toBe(true);
  });

  it("falls back to supports_reasoning when no list is given", () => {
    expect(mergeModelLists([{ id: "m" }], info({ supports_reasoning: true }))[0].reasoning).toBe(
      true,
    );
    expect(mergeModelLists([{ id: "m" }], [])[0].reasoning).toBe(false);
  });
});
