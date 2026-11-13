import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { bridgeStatusSubscription } from "../lib/live-query-options";

/**
 * Follows "open in PyOps" from the in-game panel (shift-click a block slot, or
 * the build sheet's open button). The mod sends `block.open`; the bridge status
 * poll carries the latest request, and this navigates to that block. A request
 * that predates this page load is ignored, so a reload never jumps on its own.
 */
export function GameOpenBlock() {
  const { data } = useQuery(bridgeStatusSubscription);
  const navigate = useNavigate();
  const seen = useRef<number | null>(null);
  const open = data?.openBlock ?? null;

  useEffect(() => {
    if (!data) return;
    const at = open?.at ?? 0;
    if (seen.current === null) {
      seen.current = at; // first status read: remember, don't act
      return;
    }
    if (!open || at <= seen.current) return;
    seen.current = at;
    void navigate({ to: "/block/$id", params: { id: String(open.id) } });
  }, [data, open, navigate]);

  return null;
}
