import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{ts,css,md,json,yml,yaml}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [".vitepress/cache/**", ".vitepress/dist/**"],
  },
  lint: {
    ignorePatterns: [".vitepress/cache/**", ".vitepress/dist/**"],
    options: { typeAware: true, typeCheck: true },
  },
});
