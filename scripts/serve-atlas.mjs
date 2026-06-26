#!/usr/bin/env node
// One-off: serve the atlas-out/ dir + a preview page so we can watch the
// browser load & cache the sheets. Atlas images get immutable cache headers.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = new URL("./atlas-out", import.meta.url).pathname;
const INDEX = new URL("./atlas-preview.html", import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 8723);
const MIME = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
};

http
  .createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    try {
      let file,
        immutable = false;
      if (path === "/" || path === "/index.html") {
        file = INDEX;
      } else {
        file = join(ROOT, path);
        if (file.endsWith(".png") || file.endsWith(".webp")) immutable = true;
      }
      const data = await readFile(file);
      res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
      res.setHeader(
        "Cache-Control",
        immutable ? "public, max-age=31536000, immutable" : "no-cache",
      );
      res.end(data);
      console.log(
        `200 ${path} (${(data.length / 1024).toFixed(0)} KB)${immutable ? " [immutable]" : ""}`,
      );
    } catch {
      res.statusCode = 404;
      res.end("not found: " + path);
      console.log(`404 ${path}`);
    }
  })
  .listen(PORT, () => console.log(`serving http://localhost:${PORT}`));
