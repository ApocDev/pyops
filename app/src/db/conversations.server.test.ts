import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { evictDatabase, switchDatabase } from "./index.server.ts";
import {
  getConversation,
  renameConversation,
  saveConversation,
  setConversationModel,
  setConversationReasoningEffort,
  syncConversation,
  type StoredMessage,
} from "./conversations.server.ts";
import { makeTestDb, type TestDb } from "./test-helpers.ts";

let fx: TestDb;

const message = (id: string, role: "user" | "assistant", text: string): StoredMessage => ({
  id,
  role,
  parts: JSON.stringify([{ type: "text", text }]),
});

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => {
  evictDatabase(fx.file);
  fx.cleanup();
});

describe("conversation persistence", () => {
  it("preserves model settings and an established title across ordinary turns", () => {
    setConversationModel("chat", "openai/test-model");
    setConversationReasoningEffort("chat", "high");

    syncConversation("chat", [message("u1", "user", "Plan iron plates")]);
    expect(getConversation("chat")).toMatchObject({
      title: "Plan iron plates",
      model: "openai/test-model",
      reasoningEffort: "high",
    });

    renameConversation("chat", "Iron plan");
    syncConversation("chat", [
      message("u1", "user", "Plan iron plates"),
      message("a1", "assistant", "Here is a plan."),
      message("u2", "user", "Make it faster"),
    ]);
    expect(getConversation("chat")).toMatchObject({
      title: "Iron plan",
      model: "openai/test-model",
      reasoningEffort: "high",
    });
  });

  it("updates an edited message and truncates the stale retry tail", () => {
    syncConversation("chat", [
      message("u1", "user", "First"),
      message("a1", "assistant", "First answer"),
      message("u2", "user", "Original follow-up"),
      message("a2", "assistant", "Old answer"),
    ]);

    const edited = message("u2", "user", "Edited follow-up");
    syncConversation("chat", [
      message("u1", "user", "First"),
      message("a1", "assistant", "First answer"),
      edited,
    ]);

    expect(getConversation("chat")?.messages).toEqual([
      message("u1", "user", "First"),
      message("a1", "assistant", "First answer"),
      edited,
    ]);
  });

  it("keeps full replacement for compaction and branching-style rewrites", () => {
    setConversationModel("chat", "openai/test-model");
    setConversationReasoningEffort("chat", "medium");
    saveConversation("chat", [message("u1", "user", "Long history")], "Original title");

    const compacted = message("summary", "assistant", "Summary of earlier turns");
    saveConversation("chat", [compacted], "Original title");

    expect(getConversation("chat")).toMatchObject({
      title: "Original title",
      model: "openai/test-model",
      reasoningEffort: "medium",
      messages: [compacted],
    });
  });
});
