import { useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Keyboard, Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { openCommandPalette } from "./command-palette";
import { openShortcutHelp } from "./shortcut-help-sheet";
import { SearchButton } from "./search-button";
import { AskButton } from "./ask-button";
import { navLinkActive, SETTINGS_LINK, visibleNavLinks } from "./nav-links";
import { UndoButton } from "./undo-button";
import { HorizonMenu } from "./horizon-menu";
import { LogisticsMenu } from "./logistics-menu";
import { BridgeIndicator } from "./bridge-indicator";
import { ProjectSwitcher } from "./project-switcher";
import { useFormattedCombo } from "../lib/hotkeys";
import { dataCapabilitiesFn } from "../server/factorio";

// Touch-sized rows (h-12 = 48px) — comfortably tappable, unlike the dense h-10
// desktop bar that's tuned for a mouse pointer.
const row =
  "flex items-center gap-3 px-4 h-12 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground";
const rowActive = "!text-foreground bg-muted/40 border-l-2 border-primary";
// One footer control cell, same touch height as a nav row.
const control = "flex h-12";
const actionRow = `${row} justify-start border-0 font-normal`;

/** Below ~1400px the desktop bar can't fit, so it collapses to a search control plus a
 * hamburger that opens a left drawer with the full destination list, search and
 * shortcut-help rows, and the persistent toolbar controls.
 * Rendered alongside the desktop bar in app-nav; each is gated at the same width. */
export function NavMobile() {
  const [open, setOpen] = useState(false);
  const caps = useQuery({ queryKey: ["dataCapabilities"], queryFn: () => dataCapabilitiesFn() });
  const links = [...visibleNavLinks(caps.data), SETTINGS_LINK];
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const paletteCombo = useFormattedCombo("mod+k");
  // Set when a drawer row hands off to another overlay. The drawer then skips
  // returning focus to the menu button on close, which would pull focus out of
  // the palette's search input.
  const handingOff = useRef(false);
  const handOff = (openOverlay: () => void) => {
    handingOff.current = true;
    setOpen(false);
    openOverlay();
  };

  return (
    <div className="flex flex-1 items-stretch min-[1400px]:hidden">
      {/* The bar is empty at these widths, so the field gets room; phones get a
          magnifier beside the menu button. */}
      <span className="hidden min-w-0 flex-1 items-center justify-center px-2 md:flex">
        <SearchButton size="wide" />
      </span>
      <span className="ml-auto flex md:hidden">
        <SearchButton size="icon" />
      </span>
      <AskButton size="icon" />
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
        <SheetContent
          side="left"
          className="w-72"
          onCloseAutoFocus={(e) => {
            if (handingOff.current) e.preventDefault();
            handingOff.current = false;
          }}
        >
          <SheetHeader>
            <SheetTitle className="font-mono">PyOps</SheetTitle>
          </SheetHeader>
          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 font-mono">
            {links.map((link) => {
              const { to, label, icon: Icon } = link;
              const selected = navLinkActive(link, pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  aria-current={selected ? "page" : undefined}
                  className={`${row} ${selected ? rowActive : ""}`}
                >
                  <Icon className="size-4 shrink-0" /> {label}
                </Link>
              );
            })}
            <div className="my-1 border-t border-border" />
            <Button
              variant="ghost"
              className={actionRow}
              onClick={() => handOff(openCommandPalette)}
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Search</span>
              <Kbd>{paletteCombo}</Kbd>
            </Button>
            <Button variant="ghost" className={actionRow} onClick={() => handOff(openShortcutHelp)}>
              <Keyboard className="size-4" />
              <span className="flex-1 text-left">Keyboard shortcuts</span>
              <Kbd>?</Kbd>
            </Button>
          </nav>
          {/* The shared top-bar controls size themselves `h-full` to fill the desktop bar.
              Each gets a fixed-height cell here so that height is definite: the footer then
              grows to fit every wrapped row instead of clipping them off-screen. */}
          <div className="flex shrink-0 flex-wrap gap-1 border-t border-border p-2 font-mono">
            <div className={control}>
              <UndoButton />
            </div>
            <div className={control}>
              <HorizonMenu />
            </div>
            <div className={control}>
              <LogisticsMenu />
            </div>
            <div className={control}>
              <BridgeIndicator />
            </div>
            <div className={control}>
              <ProjectSwitcher />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
