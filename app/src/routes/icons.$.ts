/**
 * Serves the generated icon atlas (sheets + manifest.json) at `/icons/*` from the
 * data dir, where it lives outside `public/` because it's user-generated (built from
 * a Factorio dump). In dev a Vite middleware serves the same path (see
 * `serveIconsDev` in vite.config); this handler covers production. Node access is
 * dynamically imported so the route file stays client-bundle-safe.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/icons/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const { ICON_DATA_DIR } = await import("#/server/paths.ts");

        const url = new URL(request.url);
        const rel = decodeURIComponent(url.pathname.replace(/^\/icons\//, ""));
        const file = path.join(ICON_DATA_DIR, path.normalize(rel));
        // never escape the data dir
        const within = path.relative(ICON_DATA_DIR, file);
        if (within.startsWith("..") || path.isAbsolute(within)) {
          return new Response("Not found", { status: 404 });
        }

        try {
          const data = await fs.readFile(file);
          const ext = path.extname(file);
          const type =
            ext === ".json"
              ? "application/json"
              : ext === ".png"
                ? "image/png"
                : "application/octet-stream";
          // Sheets are requested as `atlas-N.png?v=<fingerprint>`; the fingerprint
          // changes whenever the atlas does (per project + per dump), so a versioned
          // URL is safe to cache immutably. Unversioned requests revalidate.
          const cacheControl = url.searchParams.has("v")
            ? "public, max-age=31536000, immutable"
            : "no-cache";
          return new Response(new Uint8Array(data), {
            headers: { "Content-Type": type, "Cache-Control": cacheControl },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
