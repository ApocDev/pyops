import { defineConfig } from "vitepress";

export default defineConfig({
  title: "PyOps",
  description: "Plan, understand, and operate your Factorio factory with PyOps.",
  base: process.env.VITEPRESS_BASE ?? "/",
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    image: { lazyLoading: true },
  },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "User guide", link: "/getting-started/" },
      { text: "Development", link: "/development/" },
      { text: "Releases", link: "https://github.com/ApocDev/pyops/releases" },
    ],
    sidebar: {
      "/development/": [
        {
          text: "Development",
          items: [
            { text: "Overview", link: "/development/" },
            { text: "Architecture", link: "/development/architecture" },
            { text: "Data pipeline", link: "/development/data-pipeline" },
            { text: "Block solver", link: "/development/solver" },
            { text: "Factorio bridge", link: "/development/bridge" },
            { text: "AI assistant", link: "/development/ai-assistant" },
            { text: "Design system", link: "/development/design" },
            { text: "Desktop app and releases", link: "/development/desktop" },
            { text: "Advanced configuration", link: "/development/configuration" },
            { text: "Implementation roadmap", link: "/development/roadmap" },
          ],
        },
      ],
      "/": [
        {
          text: "Start here",
          items: [
            { text: "Documentation home", link: "/" },
            { text: "Getting started", link: "/getting-started/" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/ApocDev/pyops" }],
    editLink: {
      pattern: "https://github.com/ApocDev/pyops/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the GNU GPL v3.0 license.",
      copyright: "Copyright 2026 ApocDev",
    },
  },
});
