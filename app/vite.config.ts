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
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

const config = defineConfig({
  // generated/data files: TanStack Router output, sqlite db, icon atlas + manifest
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts", "dev.db*", "icon-data/**"],
  },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts", "dev.db*", "icon-data/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
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
