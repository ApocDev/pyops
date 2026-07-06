/**
 * gameEval approval gate (#15): the in-app assistant's gameEval tool must NOT
 * execute Lua — it returns the snippet as a proposal for the chat UI's per-call
 * Run button. The MCP surface keeps a direct-executing variant (developer
 * debugging has no chat UI to approve through).
 */
import { describe, expect, it, vi } from "vite-plus/test";

// Spy on the bridge: a proposal must never send anything to the mod.
const { requestFromMod } = vi.hoisted(() => ({ requestFromMod: vi.fn() }));
vi.mock("./bridge/inspect.ts", () => ({ requestFromMod }));

import { agentTools, gameEval, mcpTools } from "./agent-tools.server.ts";

describe("gameEval approval gate (#15)", () => {
  it("returns the snippet as a proposal without touching the bridge", async () => {
    const res = (await gameEval.execute!(
      { code: "player.force.technologies['automation'].researched", note: "check research" },
      { toolCallId: "t", messages: [] },
    )) as { proposed: boolean; code: string; note: string | null; status: string };
    expect(res.proposed).toBe(true);
    expect(res.code).toBe("player.force.technologies['automation'].researched");
    expect(res.note).toBe("check research");
    expect(res.status).toMatch(/awaiting user approval/);
    expect(requestFromMod).not.toHaveBeenCalled();
  });

  it("the chat tool set carries the gated variant", () => {
    expect(agentTools.gameEval).toBe(gameEval);
    expect(agentTools.gameEval.description).toMatch(/PROPOSE/);
  });

  it("the MCP tool set swaps in the direct-executing variant", async () => {
    expect(mcpTools.gameEval).not.toBe(agentTools.gameEval);
    expect(mcpTools.gameEval.description).not.toMatch(/PROPOSE/);
    // every other tool is shared verbatim
    for (const [name, t] of Object.entries(agentTools)) {
      if (name !== "gameEval") {
        expect((mcpTools as Record<string, unknown>)[name]).toBe(t);
      }
    }
    // and the direct variant actually calls the bridge
    requestFromMod.mockResolvedValueOnce({ ok: true, result: "42" });
    const res = (await mcpTools.gameEval.execute!(
      { code: "game.tick" },
      { toolCallId: "t", messages: [] },
    )) as { ok: boolean; result?: string };
    expect(requestFromMod).toHaveBeenCalledWith("cmd.eval", { code: "game.tick" }, 8000);
    expect(res).toEqual({ ok: true, result: "42" });
  });

  it("the dev-loop helpers are MCP-only — not in the in-app agent's tool set", () => {
    for (const name of ["gameScreenshot", "gameReloadMods", "gameShowBlock", "gameCloseSummary"]) {
      expect(agentTools).not.toHaveProperty(name);
      expect(mcpTools).toHaveProperty(name);
    }
  });
});
