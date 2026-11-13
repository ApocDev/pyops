import type { UIMessage } from "ai";

import { PAGE_CONTEXT_PART, type PageContextRecord, type PageEntity } from "#/lib/page-context.ts";

const describe = ({ kind, id, label }: PageEntity): string => {
  switch (kind) {
    case "block":
      return `block id ${id} ("${label}")`;
    case "good":
      return `the good \`${id}\` (${label})`;
    case "turd":
      return `the TURD master tech \`${id}\` (${label})`;
    case "task":
      return `task id ${id} ("${label}")`;
  }
};

/** A system-prompt section naming the page the latest user message was sent
 * from, read off that message's page-context part. Empty when the message
 * carries none (sent from the full Assistant page). */
export function pageContextNote(messages: UIMessage[]): string {
  const lastUser = messages.filter((m) => m.role === "user").at(-1);
  const part = lastUser?.parts.find((p) => p.type === PAGE_CONTEXT_PART);
  if (!part || !("data" in part)) return "";
  const { path, page, entity } = part.data as PageContextRecord;
  return (
    `\n\n## Page the user is on\n` +
    `The latest message was sent from the ${page} page (\`${path}\`)` +
    (entity ? `, focused on ${describe(entity)}.` : ".") +
    ` When the message says "this" or leaves its subject out, it most likely means that. ` +
    `This is advisory: if they ask about something else, answer that.`
  );
}
