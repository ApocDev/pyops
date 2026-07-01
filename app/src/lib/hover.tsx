import { useLayoutEffect, useRef, useState } from "react";
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

/** Generic hover shell: wraps `children` in an inline box that shows `card`
 * floating near the cursor while hovered. Layout-neutral by default
 * (`display: inline-flex`, middle-aligned) so it can wrap an icon in a flex/inline
 * row without shifting it. Every rich tooltip in the app funnels through this. */
export function CursorHover({
  card,
  className,
  z = 50,
  block = false,
  children,
}: {
  card: React.ReactNode;
  className?: string;
  z?: number;
  /** Render the wrapper as a block-level `contents`-free box instead of inline. */
  block?: boolean;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      style={block ? undefined : { display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
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
