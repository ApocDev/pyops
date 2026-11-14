import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { bridgeStatusSubscription } from "../lib/live-query-options";
import { toast } from "../lib/toast-store";

/**
 * Follows "show this in PyOps" requests from the game. The bridge status poll
 * carries the latest one, and this acts on it:
 *
 * - a block (shift-click a board slot, the build sheet's open button, or the
 *   focus hotkey matching one block): open it;
 * - a good (the focus hotkey matched several blocks): open the factory
 *   resource view for it, which lists the blocks running the recipe;
 * - nothing plans the recipe: a toast offering to create a block for its good.
 *
 * Requests are judged against the mount time, not the first status read, so
 * one that lands before that first read still opens, while one from before
 * this page loaded never jumps on its own.
 */
export function GameOpenBlock() {
  const { data } = useQuery(bridgeStatusSubscription);
  const navigate = useNavigate();
  // newest request already handled; starts at mount so older ones are ignored
  const handledAt = useRef(Date.now());
  const open = data?.openRequest ?? null;

  useEffect(() => {
    if (!open || open.at <= handledAt.current) return;
    handledAt.current = open.at;
    if (open.to === "block") {
      void navigate({ to: "/block/$id", params: { id: String(open.id) } });
    } else if (open.to === "good") {
      void navigate({
        to: "/factory",
        search: { good: open.good.name, kind: open.good.kind, recipe: open.recipe },
      });
    } else {
      const good = open.good;
      toast({
        message: `No block plans ${open.label} yet`,
        duration: 8000,
        ...(good && {
          action: {
            label: "Create one",
            onClick: () =>
              void navigate({ to: "/factory", search: { good: good.name, kind: good.kind } }),
          },
        }),
      });
    }
  }, [open, navigate]);

  return null;
}
