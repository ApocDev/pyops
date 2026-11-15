import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware, createStart } from "@tanstack/react-start";

/** Logs every server function that throws, with its stack, to the server's
 * stderr. Start sends the error on to the client but doesn't log it, so without
 * this a failure never reaches the dev console or the desktop app's server.log.
 * Redirects and not-found are control flow, not failures. */
const logServerFnErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (!isRedirect(error) && !isNotFound(error)) console.error("server function failed:", error);
    throw error;
  }
});

export const startInstance = createStart(() => ({ functionMiddleware: [logServerFnErrors] }));
