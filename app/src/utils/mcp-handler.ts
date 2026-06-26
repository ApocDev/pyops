import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export async function handleMcpRequest(request: Request, server: McpServer): Promise<Response> {
  try {
    const jsonRpcRequest = (await request.json()) as JSONRPCMessage;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Resolve on the server's reply. Notifications (no `id`) get no reply, so we
    // only wait when the request carries an id. Tools do real async work (db,
    // bridge round-trips, the LLM), so wait for the actual response rather than a
    // fixed delay — up to a generous cap.
    const hasId = typeof (jsonRpcRequest as { id?: unknown }).id !== "undefined";
    const responsePromise = new Promise<JSONRPCMessage | null>((resolve) => {
      clientTransport.onmessage = (message: JSONRPCMessage) => resolve(message);
      if (!hasId) resolve(null);
    });

    await server.connect(serverTransport);
    await clientTransport.start();
    await serverTransport.start();
    await clientTransport.send(jsonRpcRequest);

    const responseData = await Promise.race([
      responsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);

    await clientTransport.close();
    await serverTransport.close();

    // Notifications: nothing to return (202 Accepted, no body).
    if (responseData === null && !hasId) return new Response(null, { status: 202 });

    return Response.json(responseData, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("MCP handler error:", error);

    // Return a JSON-RPC error response
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
          data: error instanceof Error ? error.message : String(error),
        },
        id: null,
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
