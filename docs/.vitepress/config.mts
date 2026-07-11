import { defineConfig } from "vitepress";

const base = process.env.VITEPRESS_BASE ?? "/";

export default defineConfig({
  title: "PyOps",
  description: "Plan, understand, and operate your Factorio factory with PyOps.",
  base,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }]],
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
          ],
        },
      ],
      "/": [
        {
          text: "Start here",
          items: [
            { text: "Documentation home", link: "/" },
            { text: "Getting started", link: "/getting-started/" },
            { text: "Install PyOps", link: "/getting-started/install" },
            { text: "Choose a project", link: "/getting-started/project" },
            { text: "Sync game data", link: "/getting-started/sync-game-data" },
            { text: "Build your first block", link: "/getting-started/first-block" },
            { text: "Read the Factory view", link: "/getting-started/factory" },
          ],
        },
        {
          text: "Plan your factory",
          items: [
            { text: "Planning guide", link: "/guide/" },
            { text: "Planning horizon", link: "/guide/planning-horizon" },
            { text: "Work with blocks", link: "/guide/blocks" },
            { text: "Block boundaries", link: "/guide/block-boundaries" },
            { text: "Balance the plan", link: "/guide/balance" },
            { text: "Explore recipes and dependencies", link: "/guide/explore" },
            { text: "Plan TURD upgrades", link: "/guide/turd" },
            { text: "Back up and share", link: "/guide/backups-and-sharing" },
            { text: "Connect Factorio", link: "/guide/in-game-link" },
          ],
        },
        {
          text: "Plan and operate",
          items: [
            { text: "Use the Assistant", link: "/guide/assistant" },
            { text: "Track tasks and notes", link: "/guide/tasks-and-notes" },
          ],
        },
        {
          text: "Help and reference",
          items: [
            { text: "Troubleshooting", link: "/troubleshooting/" },
            { text: "Keyboard and navigation", link: "/reference/keyboard-and-navigation" },
            { text: "Settings and storage", link: "/reference/settings-and-storage" },
            { text: "Advanced configuration", link: "/reference/advanced-configuration" },
            { text: "Concepts and limitations", link: "/reference/concepts-and-limitations" },
            { text: "Frequently asked questions", link: "/troubleshooting/faq" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },
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
