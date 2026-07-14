import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

type GoalHandle = Pick<
  ReturnType<typeof useSortable>,
  "setActivatorNodeRef" | "listeners" | "attributes" | "isDragging"
>;

/** One sortable goal tile. Only the grip is the activator so editing a rate,
 * opening a recipe picker, and right-clicking the tile remain ordinary actions. */
export function SortableGoal({
  id,
  children,
}: {
  id: string;
  children: (handle: GoalHandle) => ReactNode;
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
