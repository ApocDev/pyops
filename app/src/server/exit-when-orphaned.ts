import { definePlugin } from "nitro";

/**
 * Desktop-shell watchdog. The Tauri launcher pipes this server's stdin and sets
 * PYOPS_EXIT_ON_STDIN_CLOSE=1. If the launcher dies by any path — the updater's
 * install step (which exits the app without running its RunEvent::Exit
 * handlers), a crash, a task-manager kill — the OS closes the pipe, stdin hits
 * EOF, and the server exits with it. Without this an orphaned server keeps
 * files locked during a Windows update and keeps answering on the port with
 * the old version after a relaunch. No-op in dev and plain `node index.mjs`
 * runs, where the flag is unset.
 */
export default definePlugin(() => {
  if (process.env.PYOPS_EXIT_ON_STDIN_CLOSE !== "1") return;
  const exit = () => process.exit(0);
  process.stdin.on("end", exit);
  process.stdin.on("close", exit);
  process.stdin.on("error", exit);
  process.stdin.resume();
});
