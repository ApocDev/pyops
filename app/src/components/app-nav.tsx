import { useSyncExternalStore } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectSwitcher } from "./project-switcher";
import { BridgeIndicator } from "./bridge-indicator";
import { HorizonMenu } from "./horizon-menu";
import { LogisticsMenu } from "./logistics-menu";
import { NavMobile } from "./nav-mobile";
import { SearchButton } from "./search-button";
import { AskButton } from "./ask-button";
import { navLinkActive, SETTINGS_LINK, TOPBAR_LABEL, visibleNavLinks } from "./nav-links";
import { UndoButton } from "./undo-button";
import { activeRunCount, subscribeRuns } from "../lib/chat-runs";
import { dataCapabilitiesFn, modDriftFn } from "../server/factorio";
import { driftModal } from "../lib/drift-store";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/** Persistent re-entry point for the data-sync modal: a small warning-toned chip
 * whenever the game's mods or PyOps' data reader have drifted from the project's
 * reference data. Hidden when data is in sync. */
function DataDriftIndicator() {
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });
  if (!drift.data?.needsRedump) return null;
  return (
    <Tooltip content="Reference data no longer matches the current mods or data reader — click to review and re-sync.">
      <Button
        variant="ghost"
        aria-label="Data stale"
        onClick={() => driftModal.open()}
        className="h-full gap-1.5 px-3 font-normal text-warning hover:bg-muted/50 hover:text-warning"
      >
        <span className="inline-block size-2 rounded-full bg-warning" />
        <span className={`hidden sm:inline ${TOPBAR_LABEL}`}>Data stale</span>
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
    <Tooltip content="Assistant runs in progress">
      <Link
        to="/assistant"
        aria-label={`${n} running`}
        className="flex items-center gap-1.5 px-3 text-sm text-primary hover:bg-muted/50"
      >
        <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
        {n}
        <span className={TOPBAR_LABEL}>running</span>
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
      <div className="@container/topbar hidden min-w-0 flex-1 items-stretch min-[1400px]:flex">
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
        {/* When the bar runs short, the search field shrinks to its icon and key hint
            (min-w-21 = that + px-2), and the horizon and project names truncate. Below
            the TOPBAR_LABEL width the status chips also fold to their dot or count. */}
        <span className="ml-auto flex min-w-21 items-center px-2">
          <SearchButton size="short" />
        </span>
        <AskButton size="label" />
        <span className="flex min-w-0 items-stretch whitespace-nowrap">
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
