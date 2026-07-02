import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { SETTINGS_LINK, visibleNavLinks } from "./nav-links";
import { HorizonMenu } from "./horizon-menu";
import { LogisticsMenu } from "./logistics-menu";
import { BridgeIndicator } from "./bridge-indicator";
import { ProjectSwitcher } from "./project-switcher";
import { dataCapabilitiesFn } from "../server/factorio";

// Touch-sized rows (h-12 = 48px) — comfortably tappable, unlike the dense h-10
// desktop bar that's tuned for a mouse pointer.
const row =
  "flex items-center gap-3 px-4 h-12 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground";
const rowActive = "!text-foreground bg-muted/40 border-l-2 border-primary";

/** Below ~1400px the desktop bar can't fit, so it collapses to a hamburger that opens
 * a left drawer with the full destination list plus the persistent toolbar controls.
 * Rendered alongside the desktop bar in app-nav; each is gated at the same width. */
export function NavMobile() {
  const [open, setOpen] = useState(false);
  const caps = useQuery({ queryKey: ["dataCapabilities"], queryFn: () => dataCapabilitiesFn() });
  const links = [...visibleNavLinks(caps.data), SETTINGS_LINK];

  return (
    <div className="flex flex-1 items-stretch justify-end min-[1400px]:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 text-muted-foreground hover:bg-muted/50"
          >
            <Menu className="size-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle className="font-mono">PyOps</SheetTitle>
          </SheetHeader>
          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 font-mono">
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={row}
                activeProps={{ className: `${row} ${rowActive}` }}
              >
                <Icon className="size-4 shrink-0" /> {label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border p-2 font-mono">
            <HorizonMenu />
            <LogisticsMenu />
            <BridgeIndicator />
            <ProjectSwitcher />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
