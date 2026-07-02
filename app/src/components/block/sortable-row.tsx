import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

/** One sortable recipe row. Provides the drag handle props to its child via render
 * prop so only the grip starts a drag; the outer wrapper carries the sort transform. */
export type RowHandle = Pick<
  ReturnType<typeof useSortable>,
  "setActivatorNodeRef" | "listeners" | "attributes" | "isDragging"
>;

export function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handle: RowHandle) => ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: isDragging ? "relative" : undefined,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={isDragging ? "opacity-90" : undefined}
    >
      {children({ setActivatorNodeRef, listeners, attributes, isDragging })}
    </div>
  );
}
