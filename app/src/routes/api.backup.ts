/**
 * Project backup over HTTP (#82): GET streams the active project's db as a
 * download (an online-backup snapshot, so it's consistent while the app runs);
 * POST accepts an uploaded .db (raw request body) and installs it as a NEW
 * project (`?name=` labels it). A route handler, not a server fn, because both
 * directions move a whole sqlite file — streamed, never JSON-encoded.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createProjectBackup, importProjectDb } from "#/server/backup.server.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const Route = createFileRoute("/api/backup")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const b = await createProjectBackup();
          const stream = createReadStream(b.file);
          stream.once("close", b.cleanup); // temp snapshot dies with the stream
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            headers: {
              "Content-Type": "application/vnd.sqlite3",
              "Content-Length": String(b.size),
              "Content-Disposition": `attachment; filename="${b.downloadName}"`,
            },
          });
        } catch (e) {
          return Response.json({ error: message(e) }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const name = new URL(request.url).searchParams.get("name") ?? undefined;
        if (!request.body) return Response.json({ error: "empty upload" }, { status: 400 });
        const dir = mkdtempSync(join(tmpdir(), "pyops-import-"));
        const tmp = join(dir, "upload.db");
        try {
          await pipeline(
            Readable.fromWeb(request.body as import("node:stream/web").ReadableStream),
            createWriteStream(tmp),
          );
          return Response.json(importProjectDb(tmp, name));
        } catch (e) {
          return Response.json({ error: message(e) }, { status: 400 });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  },
});
