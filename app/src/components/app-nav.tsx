import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectSwitcher } from "./project-switcher";
import { BridgeIndicator } from "./bridge-indicator";
import { HorizonMenu } from "./horizon-menu";
import { activeRunCount, subscribeRuns } from "../lib/chat-store";
import { modDriftFn } from "../server/factorio";
import { driftModal } from "../lib/drift-store";

/** Persistent re-entry point for the data-sync modal: a small amber chip in the
 * nav whenever the game's mods have drifted from the project's reference data
 * (so dismissing the popup doesn't strand it). Hidden when data is in sync. */
function DataDriftIndicator() {
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });
  if (!drift.data?.needsRedump) return null;
  return (
    <button
      onClick={() => driftModal.open()}
      title="The game's mods changed since your last data sync — click to review and re-sync."
      className="flex items-center gap-1.5 px-3 text-sm text-amber-300 hover:bg-muted/50"
    >
      <span className="inline-block size-2 rounded-full bg-amber-400" />
      <span className="hidden sm:inline">data stale</span>
    </button>
  );
}

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
        <DataDriftIndicator />
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
