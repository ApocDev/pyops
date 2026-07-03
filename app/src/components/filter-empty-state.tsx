import { Button } from "#/components/ui/button.tsx";
import { EmptyState } from "#/components/empty-state.tsx";

/** The standard "no matches for X" state of a filtered list (#87): names the
 * query and offers to clear it (docs/design.md — a filtered-empty surface says
 * so and offers the fix). Render it when the unfiltered list is non-empty but
 * the filtered one is. */
export function FilterEmptyState({
  query,
  onClear,
  className,
}: {
  query: string;
  onClear: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      title={`No matches for "${query.trim()}"`}
      description="Try a different search term, or clear the filter."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          clear filter
        </Button>
      }
    />
  );
}
