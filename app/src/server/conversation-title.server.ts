/**
 * AI title generation for stored conversations — server-only. A plain function
 * (not a server fn) so both the chat route (after the first exchange) and the
 * `generateTitleFn` server fn can call it directly.
 */
import { generateText } from "ai";
import * as store from "../db/conversations.server.ts";
import { resolveApiKey } from "./app-config.server.ts";
import { getModel, reasoningProviderOptions } from "./agent.ts";

/** Plain text from a stored message's JSON parts. */
function textOf(parts: string): string {
  try {
    return (JSON.parse(parts) as { type?: string; text?: string }[])
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}

/** Generate a short AI title for a conversation from its first exchange and save
 * it. No-ops (keeps the question-derived title) if there's no API key or the model
 * call fails. Returns the new title, or null. */
export async function generateConversationTitle(id: string) {
  const conv = store.getConversation(id);
  if (!conv) return null;
  const user = conv.messages.find((m) => m.role === "user");
  const asst = conv.messages.find((m) => m.role === "assistant");
  const transcript = [
    user && `User: ${textOf(user.parts).slice(0, 600)}`,
    asst && `Assistant: ${textOf(asst.parts).slice(0, 600)}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!transcript) return null;

  if (!resolveApiKey().key) return null;
  try {
    const { text } = await generateText({
      // generous cap: reasoning models (e.g. gpt-5.x) spend output tokens on
      // reasoning before emitting the title, so a tiny cap yields empty text
      model: getModel(),
      providerOptions: reasoningProviderOptions(null, "low", { exclude: true }),
      maxOutputTokens: 512,
      prompt:
        "Write a short, specific title (max 6 words) for this assistant conversation. " +
        "Plain text only — no quotes, no trailing punctuation.\n\n" +
        transcript,
    });
    const title = text
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/, "")
      .trim()
      .slice(0, 70);
    if (title) store.renameConversation(id, title);
    return title || null;
  } catch {
    return null;
  }
}
