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

/** Data-driven, mod-specific capabilities of the loaded dataset (see
 * `dataCapabilities` in db/queries). A nav link tagged with one is hidden when the
 * data behind it is absent — e.g. TURD on a non-Py mod set. See #68. */
export type NavCapabilities = { hasTurd: boolean };

export type NavLink = {
  to: NavLinkTo;
  label: string;
  icon: LucideIcon;
  /** Hidden once we know the dataset lacks this capability; absent → always shown. */
  capability?: keyof NavCapabilities;
};

/** The primary cluster (left side of the desktop bar). */
export const NAV_LINKS: NavLink[] = [
  { to: "/block", label: "Blocks", icon: Blocks },
  { to: "/factory", label: "Factory", icon: Factory },
  { to: "/coherence", label: "Coherence", icon: ArrowLeftRight },
  { to: "/browse", label: "Browse", icon: Search },
  { to: "/turd", label: "TURD", icon: FlaskConical, capability: "hasTurd" },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
];

/** Nav links to show for the given capabilities. A capability-tagged link is hidden
 * only once caps are loaded and the flag is explicitly false — so it never flashes
 * out while caps are still loading (the common Py case shows it immediately). */
export function visibleNavLinks(caps: NavCapabilities | undefined): NavLink[] {
  return NAV_LINKS.filter((l) => !l.capability || caps?.[l.capability] !== false);
}

/** Settings sits in the right cluster on desktop; folded in with the rest on mobile. */
export const SETTINGS_LINK: NavLink = { to: "/settings", label: "Settings", icon: Settings };
