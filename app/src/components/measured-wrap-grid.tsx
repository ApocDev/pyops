import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

/**
 * A wrapping grid whose columns all match the widest direct child. CSS Grid can
 * auto-repeat a fixed track safely, but cannot derive that repeat width from
 * max-content. Measure once from a conservative minimum, then feed the widest
 * observed child back as the fixed auto-fill track width.
 */
export function MeasuredWrapGrid({
  minColumnWidth = 80,
  className,
  children,
  style,
  ...props
}: Omit<ComponentProps<"div">, "children" | "ref"> & {
  minColumnWidth?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    let frame = 0;
    const intrinsicWidth = (el: HTMLElement) => {
      const clone = el.cloneNode(true) as HTMLElement;
      Object.assign(clone.style, {
        position: "fixed",
        insetInlineStart: "-10000px",
        top: "0",
        width: "max-content",
        maxWidth: "none",
        visibility: "hidden",
        pointerEvents: "none",
        transform: "none",
      });
      document.body.append(clone);
      try {
        // Grid items normally stretch to their track, which hides both growth
        // and shrinkage in their intrinsic width. Measure a hidden content-sized
        // clone so probing never perturbs the live grid's observed layout.
        return Math.max(clone.scrollWidth, clone.getBoundingClientRect().width);
      } finally {
        clone.remove();
      }
    };
    const measure = () => {
      const available = grid.clientWidth || Number.POSITIVE_INFINITY;
      const widest = Array.from(grid.children, (child) =>
        intrinsicWidth(child as HTMLElement),
      ).reduce((max, width) => Math.max(max, width), minColumnWidth);
      const next = Math.ceil(Math.min(Math.max(minColumnWidth, widest), available));
      setColumnWidth((current) => (current === next ? current : next));
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("resize", scheduleMeasure);
    const mutations = new MutationObserver(scheduleMeasure);
    mutations.observe(grid, { childList: true, characterData: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      mutations.disconnect();
    };
  }, [children, minColumnWidth]);

  return (
    <div
      {...props}
      ref={ref}
      className={cn("grid auto-rows-max justify-start", className)}
      style={{
        ...style,
        gridTemplateColumns:
          columnWidth == null
            ? `repeat(auto-fit, minmax(${minColumnWidth}px, max-content))`
            : `repeat(auto-fill, ${columnWidth}px)`,
      }}
    >
      {children}
    </div>
  );
}
