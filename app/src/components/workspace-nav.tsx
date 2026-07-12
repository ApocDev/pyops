import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  Network,
  Search,
  SlidersHorizontal,
} from "lucide-react";

const factoryLinks = [
  { to: "/factory", label: "Overview", icon: ChartNoAxesCombined },
  { to: "/factory/connections", label: "Connections", icon: ArrowLeftRight },
  { to: "/factory/scenario", label: "Scenario", icon: SlidersHorizontal },
] as const;

const exploreLinks = [
  { to: "/explore", label: "Search", icon: Search },
  { to: "/explore/dependencies", label: "Dependencies", icon: Network },
] as const;

/** Secondary navigation for related views that form one user-facing workspace. */
export function WorkspaceNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const links =
    pathname === "/factory" || pathname.startsWith("/factory/")
      ? factoryLinks
      : pathname === "/explore" || pathname.startsWith("/explore/")
        ? exploreLinks
        : null;

  if (!links) return null;

  return (
    <nav
      aria-label={links === factoryLinks ? "Factory views" : "Explore views"}
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-background px-2 font-mono"
    >
      {links.map(({ to, label, icon: Icon }) => {
        const selected = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={selected ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors ${
              selected
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
