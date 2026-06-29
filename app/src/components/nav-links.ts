import {
  ArrowLeftRight,
  Blocks,
  Factory,
  FlaskConical,
  ListChecks,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** Top-level destinations, shared by the desktop nav bar (app-nav) and the mobile
 * drawer (nav-mobile) so the two never drift. `to` is the literal-union of app
 * routes so TanStack's typed <Link> stays happy. */
export type NavLinkTo =
  | "/block"
  | "/factory"
  | "/coherence"
  | "/browse"
  | "/turd"
  | "/assistant"
  | "/tasks"
  | "/settings";

export type NavLink = { to: NavLinkTo; label: string; icon: LucideIcon };

/** The primary cluster (left side of the desktop bar). */
export const NAV_LINKS: NavLink[] = [
  { to: "/block", label: "Blocks", icon: Blocks },
  { to: "/factory", label: "Factory", icon: Factory },
  { to: "/coherence", label: "Coherence", icon: ArrowLeftRight },
  { to: "/browse", label: "Browse", icon: Search },
  { to: "/turd", label: "TURD", icon: FlaskConical },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
];

/** Settings sits in the right cluster on desktop; folded in with the rest on mobile. */
export const SETTINGS_LINK: NavLink = { to: "/settings", label: "Settings", icon: Settings };
