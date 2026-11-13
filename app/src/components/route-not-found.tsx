import { Link } from "@tanstack/react-router";
import { House, SearchX } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { EmptyState } from "#/components/empty-state.tsx";

/**
 * The router's root `notFoundComponent`: a URL that matches no route (a stale
 * bookmark, a typo, a removed page) lands here instead of TanStack's bare
 * "Not Found" text.
 */
export function RouteNotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="Nothing lives at this address."
        action={
          <Button variant="outline" asChild>
            <Link to="/">
              <House /> Home
            </Link>
          </Button>
        }
        className="border border-border bg-card"
      />
    </div>
  );
}
