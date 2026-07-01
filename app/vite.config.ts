import { defineConfig } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

import { createReadStream, statSync } from "node:fs";
import { extname, join } from "node:path";

const isVpLint = process.env.VP_COMMAND === "lint";

// Dev: let the dev server be reached through a tunnel (see scripts/tunnel-dev).
// Vite rejects requests whose Host header isn't localhost ("Blocked request. This
// host is not allowed."), so permit the tunnel providers' domains. Add your own
// host(s) via PYOPS_ALLOWED_HOSTS (comma-separated); set it to "true"/"all" to
// allow any host.
const extraHosts = (process.env.PYOPS_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const allowedHosts: true | string[] =
  extraHosts.includes("true") || extraHosts.includes("all")
    ? true
    : [
        ".ts.net", // tailscale funnel
        ".trycloudflare.com", // cloudflared quick tunnel
        ".ngrok-free.app", // ngrok free static domain
        ".ngrok.app",
        ".ngrok.io",
        ".ngrok.dev",
        ...extraHosts, // custom (e.g. your own cloudflared domain)
      ];

// Dev-only: serve /icons/* from app/icon-data (out of public/). vite-plus's
// nitro-nightly dev static handler corrupts public/ files over 64KB (the atlas
// sheets + manifest restart mid-stream), so we serve them ourselves. Registered
// first; reads from a non-public dir so nitro never claims the path.
function serveIconsDev() {
  return {
    name: "pyops-serve-icons",
    apply: "serve" as const,
    enforce: "pre" as const,
    configureServer(server: {
      middlewares: {
        use: (
          path: string,
          fn: (req: { url?: string }, res: any, next: () => void) => void,
        ) => void;
      };
    }) {
      const dir = join(process.cwd(), "icon-data");
      server.middlewares.use("/icons", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        if (rel.includes("..")) return next();
        const file = join(dir, rel);
        let size: number;
        try {
          size = statSync(file).size;
        } catch {
          return next();
        }
        const ext = extname(file);
        res.setHeader(
          "Content-Type",
          ext === ".json"
            ? "application/json"
            : ext === ".png"
              ? "image/png"
              : "application/octet-stream",
        );
        res.setHeader("Content-Length", String(size));
        // versioned (`?v=<fingerprint>`) sheet URLs are immutable; else revalidate
        res.setHeader(
          "Cache-Control",
          /[?&]v=/.test(req.url ?? "") ? "public, max-age=31536000, immutable" : "no-cache",
        );
        createReadStream(file).pipe(res);
      });
    },
  };
}

const config = defineConfig({
  // generated/data files: TanStack Router output, sqlite db, icon atlas + manifest.
  // `e2e/**` is a standalone Playwright package (own deps + tooling) — not ours.
  // release-please re-serializes `src-tauri/tauri.conf.json` its own way each release,
  // so don't let oxfmt fight it (the changelog it owns lives at the repo root, outside
  // this app/ scope).
  fmt: {
    ignorePatterns: [
      "src/routeTree.gen.ts",
      "dev.db*",
      "icon-data/**",
      "drizzle/**",
      "e2e/**",
      "src-tauri/tauri.conf.json",
    ],
  },
  lint: {
    ignorePatterns: [
      "src/routeTree.gen.ts",
      "dev.db*",
      "icon-data/**",
      "drizzle/**",
      "e2e/**",
      "src-tauri/tauri.conf.json",
    ],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
  // host: true binds all interfaces so a tunnel can reach the server. Without it
  // Vite binds only `localhost`, which on some systems resolves to IPv6 `::1`
  // while tunnels (e.g. tailscale funnel) dial IPv4 `127.0.0.1` → 502. The
  // allowedHosts list above still gates which Host headers are served.
  server: { host: true, allowedHosts },
  plugins: isVpLint
    ? []
    : [
        serveIconsDev(),
        devtools(),
        nitro({ rollupConfig: { external: [/^@sentry\//] } }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        babel({ presets: [reactCompilerPreset()] }),
      ],
});

export default config;
