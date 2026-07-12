import { useSyncExternalStore } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectSwitcher } from "./project-switcher";
import { BridgeIndicator } from "./bridge-indicator";
import { HorizonMenu } from "./horizon-menu";
import { LogisticsMenu } from "./logistics-menu";
import { NavMobile } from "./nav-mobile";
import { navLinkActive, SETTINGS_LINK, visibleNavLinks } from "./nav-links";
import { UndoButton } from "./undo-button";
import { activeRunCount, subscribeRuns } from "../lib/chat-store";
import { dataCapabilitiesFn, modDriftFn } from "../server/factorio";
import { driftModal } from "../lib/drift-store";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/** Persistent re-entry point for the data-sync modal: a small warning-toned chip in the
 * nav whenever the game's mods have drifted from the project's reference data
 * (so dismissing the popup doesn't strand it). Hidden when data is in sync. */
function DataDriftIndicator() {
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });
  if (!drift.data?.needsRedump) return null;
  return (
    <Tooltip content="The game's mods changed since your last data sync — click to review and re-sync.">
      <Button
        variant="ghost"
        onClick={() => driftModal.open()}
        className="h-full gap-1.5 px-3 font-normal text-warning hover:bg-muted/50 hover:text-warning"
      >
        <span className="inline-block size-2 rounded-full bg-warning" />
        <span className="hidden sm:inline">data stale</span>
      </Button>
    </Tooltip>
  );
}

/** Shows how many assistant runs are generating right now (from anywhere in the
 * app, since runs continue across navigation). Links back to the assistant. */
function RunIndicator() {
  const n = useSyncExternalStore(subscribeRuns, activeRunCount, () => 0);
  if (n === 0) return null;
  return (
    <Tooltip content="assistant runs in progress">
      <Link
        to="/assistant"
        className="flex items-center gap-1.5 px-3 text-sm text-primary hover:bg-muted/50"
      >
        <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
        {n} running
      </Link>
    </Tooltip>
  );
}

const item =
  "flex items-center gap-1.5 px-3 h-full text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50";
const active = "!text-foreground border-b-2 border-primary bg-muted/30";

/** Global top bar — the one fixed piece of chrome on every page. The full inline
 * bar shows from `xl` up (desktop/Steam Deck); below that it collapses to a
 * hamburger drawer (NavMobile) so it never forces the page wider than the screen. */
export function AppNav() {
  const caps = useQuery({ queryKey: ["dataCapabilities"], queryFn: () => dataCapabilitiesFn() });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav className="flex h-10 shrink-0 items-stretch border-b border-border bg-card font-mono">
      <Link to="/" className="flex items-center gap-2 px-3 font-bold text-primary">
        <img src="/logo.svg" alt="" className="size-6" />
        <span>PyOps</span>
      </Link>

      {/* Full inline bar — only once it actually fits (~1400px). Below that it would
          overflow and scroll sideways (notably at the 1280 Steam Deck width), so the
          hamburger drawer takes over. */}
      <div className="hidden flex-1 items-stretch min-[1400px]:flex">
        {visibleNavLinks(caps.data).map((link) => {
          const { to, label, icon: Icon } = link;
          return (
            <Link
              key={to}
              to={to}
              aria-current={navLinkActive(link, pathname) ? "page" : undefined}
              className={`${item} ${navLinkActive(link, pathname) ? active : ""}`}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        })}
        <span className="ml-auto flex items-stretch">
          <UndoButton />
          <DataDriftIndicator />
          <RunIndicator />
          <HorizonMenu />
          <LogisticsMenu />
          <BridgeIndicator />
          <ProjectSwitcher />
          <Link
            to={SETTINGS_LINK.to}
            className={item}
            activeProps={{ className: `${item} ${active}` }}
          >
            <SETTINGS_LINK.icon className="size-4" /> {SETTINGS_LINK.label}
          </Link>
        </span>
      </div>

      {/* Below ~1400px: hamburger + drawer. */}
      <NavMobile />
    </nav>
  );
}
