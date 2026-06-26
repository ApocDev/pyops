import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { ProjectSwitcher } from "./project-switcher";
import { BridgeIndicator } from "./bridge-indicator";
import { HorizonMenu } from "./horizon-menu";
import { activeRunCount, subscribeRuns } from "../lib/chat-store";

/** Shows how many assistant runs are generating right now (from anywhere in the
 * app, since runs continue across navigation). Links back to the assistant. */
function RunIndicator() {
  const n = useSyncExternalStore(subscribeRuns, activeRunCount, () => 0);
  if (n === 0) return null;
  return (
    <Link
      to="/assistant"
      className="flex items-center gap-1.5 px-3 text-sm text-primary hover:bg-muted/50"
      title="assistant runs in progress"
    >
      <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
      {n} running
    </Link>
  );
}

const item =
  "flex items-center gap-1.5 px-3 h-full text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50";
const active = "!text-foreground border-b-2 border-primary bg-muted/30";

/** Global top bar — the one fixed piece of chrome on every page. */
export function AppNav() {
  return (
    <nav className="flex h-10 shrink-0 items-stretch border-b border-border bg-card font-mono">
      <Link to="/" className="flex items-center gap-2 px-3 font-bold text-primary">
        <img src="/logo.svg" alt="" className="size-6" />
        <span>PyOps</span>
      </Link>
      <Link to="/block" className={item} activeProps={{ className: `${item} ${active}` }}>
        ⬚ Blocks
      </Link>
      <Link to="/factory" className={item} activeProps={{ className: `${item} ${active}` }}>
        ∑ Factory
      </Link>
      <Link to="/coherence" className={item} activeProps={{ className: `${item} ${active}` }}>
        ⇄ Coherence
      </Link>
      <Link to="/browse" className={item} activeProps={{ className: `${item} ${active}` }}>
        ⌕ Browse
      </Link>
      <Link to="/turd" className={item} activeProps={{ className: `${item} ${active}` }}>
        ⚗ TURD
      </Link>
      <Link to="/assistant" className={item} activeProps={{ className: `${item} ${active}` }}>
        ✦ Assistant
      </Link>
      <Link to="/tasks" className={item} activeProps={{ className: `${item} ${active}` }}>
        ✓ Tasks
      </Link>
      <span className="ml-auto flex items-stretch">
        <RunIndicator />
        <HorizonMenu />
        <BridgeIndicator />
        <ProjectSwitcher />
        <Link to="/settings" className={item} activeProps={{ className: `${item} ${active}` }}>
          ⚙ Settings
        </Link>
      </span>
    </nav>
  );
}
