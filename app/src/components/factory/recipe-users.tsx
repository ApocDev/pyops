import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { EmptyState } from "#/components/empty-state.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { blocksUsingRecipeFn } from "../../server/recipe-blocks-fns";

/** The blocks running one recipe, as links. The factory resource view shows
 * this when the game's focus hotkey matched several blocks, so the player
 * picks one; blocks that use the recipe only internally (no boundary flow of
 * the good) still show up here. */
export function RecipeUsers({ recipe }: { recipe: string }) {
  const users = useQuery({
    queryKey: ["blocksUsingRecipe", recipe],
    queryFn: () => blocksUsingRecipeFn({ data: recipe }),
  });

  if (users.isLoading) {
    return (
      <div className="mb-4 space-y-1">
        <Skeleton className="mb-2 h-4 w-28" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (users.isError || !users.data) {
    return (
      <QueryError
        title="Couldn’t load the blocks running this recipe"
        message={users.error instanceof Error ? users.error.message : undefined}
        onRetry={() => void users.refetch()}
        className="mb-4"
      />
    );
  }
  const { display, blocks } = users.data;
  return (
    <div className="mb-4">
      <FieldLabel className="mb-1 font-semibold">
        Running {display} {blocks.length > 0 && `(${blocks.length})`}
      </FieldLabel>
      {blocks.length === 0 ? (
        <EmptyState
          className="px-2 py-3"
          title="No blocks"
          description="No enabled block runs this recipe"
        />
      ) : (
        blocks.map((b) => (
          <Link
            key={b.id}
            to="/block/$id"
            params={{ id: String(b.id) }}
            className="block truncate px-2 py-1.5 text-sm hover:bg-muted"
          >
            {b.name}
          </Link>
        ))
      )}
    </div>
  );
}
