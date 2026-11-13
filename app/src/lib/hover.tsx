import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Portals a hover card near the cursor and keeps it fully on-screen: it prefers
 * below-right of the pointer and flips to the cursor's left / above when the card
 * would overflow that edge, then clamps to an 8px margin. Measures the real
 * rendered card (not a guessed size) and re-measures on cursor move and whenever
 * the card resizes — its detail data loads async, so a tall card would otherwise
 * run off the bottom before the next mouse move. */
export function CursorCard({
  pos,
  z = 50,
  children,
}: {
  pos: { x: number; y: number };
  z?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const GAP = 16; // offset from the cursor
    const M = 8; // viewport margin
    const reposition = () => {
      const { width, height } = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = pos.x + GAP;
      if (left + width > vw - M) left = pos.x - GAP - width; // flip to the cursor's left
      left = Math.max(M, Math.min(left, vw - width - M));
      let top = pos.y + GAP;
      if (top + height > vh - M) top = pos.y - GAP - height; // flip above the cursor
      top = Math.max(M, Math.min(top, vh - height - M));
      setPlace({ left, top });
    };
    reposition();
    const ro = new ResizeObserver(reposition);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pos.x, pos.y]);
  return createPortal(
    <div
      ref={ref}
      data-hover-card
      style={{
        position: "fixed",
        // hidden until the first measure so it never flashes at the wrong spot
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        zIndex: z,
        pointerEvents: "none",
        visibility: place ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

type Point = { x: number; y: number };

const FOCUS_DELAY_MS = 400; // tabbing past a trigger shouldn't flash its card
const LONG_PRESS_MS = 450;
const PRESS_SLOP_PX = 10; // finger drift allowed before a press counts as a scroll

/** Open/close state for a rich hover card, shared by every hover wrapper. Spread
 * `triggerProps` on the wrapper element and render `<CursorCard pos={pos}>` while
 * `pos` is set. The card opens on:
 * - mouse hover, following the cursor;
 * - keyboard focus (`:focus-visible` only, so a mouse click doesn't open it) after
 *   a short delay, anchored under the focused element; blur or Escape closes it;
 * - touch long-press, at the finger. The press's own click and context menu are
 *   swallowed so a tap still opens what it always did, and the next touch
 *   anywhere dismisses the card. Long-press is skipped inside any element marked
 *   `data-context-menu` (one with its own right-click menu): on touch, the
 *   browser's long-press `contextmenu` is the only way to reach that menu. */
export function useHoverCard() {
  const [pos, setPos] = useState<Point | null>(null);
  const [pinned, setPinned] = useState(false); // opened by long-press, outlives the touch
  const timer = useRef<number | undefined>(undefined);
  const press = useRef<Point | null>(null);
  const swallowClick = useRef(false);

  const clearTimer = () => window.clearTimeout(timer.current);
  const close = () => {
    clearTimer();
    setPos(null);
    setPinned(false);
    swallowClick.current = false;
  };
  const endPress = () => {
    press.current = null;
    clearTimer();
  };
  const openFromPress = (at: Point) => {
    clearTimer();
    swallowClick.current = true;
    setPos(at);
    setPinned(true);
  };

  useEffect(() => clearTimer, []);
  useEffect(() => {
    if (!pinned) return;
    const dismiss = () => close();
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [pinned]);

  const triggerProps = {
    onMouseEnter: (e: React.MouseEvent) => setPos({ x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setPos({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => {
      if (!pinned) close();
    },
    onFocus: (e: React.FocusEvent) => {
      const el = e.target;
      if (!el.matches(":focus-visible")) return;
      clearTimer();
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setPos({ x: r.left, y: r.bottom });
      }, FOCUS_DELAY_MS);
    },
    onBlur: (e: React.FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget)) close();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    onPointerDown: (e: React.PointerEvent) => {
      swallowClick.current = false;
      if (e.pointerType !== "touch") return;
      if (e.target instanceof Element && e.target.closest("[data-context-menu]")) return;
      const at = { x: e.clientX, y: e.clientY };
      press.current = at;
      clearTimer();
      timer.current = window.setTimeout(() => openFromPress(at), LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const at = press.current;
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > PRESS_SLOP_PX) {
        press.current = null;
        clearTimer();
      }
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
    // Some mobile browsers fire `contextmenu` on long-press before our timer;
    // treat it as the long-press so the card wins over the trigger's menu.
    onContextMenuCapture: (e: React.MouseEvent) => {
      const at = press.current;
      if (!at && !swallowClick.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (at) openFromPress(at);
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
  return { pos, triggerProps };
}

/** Generic hover shell: wraps `children` in an inline box that shows `card`
 * floating near the cursor while hovered (or focused / long-pressed, see
 * `useHoverCard`). Layout-neutral by default
 * (`display: inline-flex`, middle-aligned) so it can wrap an icon in a flex/inline
 * row without shifting it. Every rich tooltip in the app funnels through this. */
export function CursorHover({
  card,
  className,
  z = 50,
  block = false,
  good,
  children,
}: {
  card: React.ReactNode;
  className?: string;
  z?: number;
  /** Render the wrapper as a block-level `contents`-free box instead of inline. */
  block?: boolean;
  /** Tag an item/fluid trigger for the global Alt+Click recipe explorer. */
  good?: { name: string; kind: "item" | "fluid" };
  children: React.ReactNode;
}) {
  const { pos, triggerProps } = useHoverCard();
  return (
    <span
      className={className}
      data-good-kind={good?.kind}
      data-good-name={good?.name}
      style={block ? undefined : { display: "inline-flex", verticalAlign: "middle" }}
      {...triggerProps}
    >
      {children}
      {pos && typeof document !== "undefined" && (
        <CursorCard pos={pos} z={z}>
          {card}
        </CursorCard>
      )}
    </span>
  );
}
