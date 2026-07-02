/**
 * MCP endpoint (`POST /mcp`) — exposes the planning agent's tool set to EXTERNAL
 * MCP clients (e.g. Claude driving the running game to debug the integration),
 * not just the in-app assistant. Same tool bodies as `server/agent-tools.ts`,
 * including the read-only live game-world tools and the task tools.
 *
 * The agent tools are dynamically imported inside the (server-only) handler so
 * better-sqlite3 / the dgram bridge never reach the client bundle.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFileRoute } from "@tanstack/react-router";
import type { ZodRawShape } from "zod";

import { handleMcpRequest } from "#/utils/mcp-handler";
import { agentTools } from "#/server/agent-tools.server.ts";

/** Minimal shape we rely on from an AI-SDK `tool()` to bridge it to MCP. */
type AiTool = {
  description?: string;
  inputSchema?: { shape?: ZodRawShape };
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

// Built once and reused across requests (handleMcpRequest connects/closes a
// transport per call).
let serverPromise: Promise<McpServer> | null = null;
function getServer(): Promise<McpServer> {
  serverPromise ??= (async () => {
    const server = new McpServer({ name: "pyops", version: "1.0.0" });
    for (const [name, raw] of Object.entries(agentTools)) {
      const t = raw as AiTool;
      if (!t.execute) continue;
      const exec = t.execute;
      server.registerTool(
        name,
        { description: t.description ?? name, inputSchema: t.inputSchema?.shape ?? {} },
        async (args: Record<string, unknown>) => {
          const result = await exec(args, { toolCallId: name, messages: [] });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );
    }
    return server;
  })();
  return serverPromise;
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMcpRequest(request, await getServer()),
    },
  },
});
