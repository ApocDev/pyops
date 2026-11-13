import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { bridgeStatusSubscription } from "../lib/live-query-options";

/**
 * Follows "open in PyOps" from the in-game panel (shift-click a block slot, or
 * the build sheet's open button). The mod sends `block.open`; the bridge status
 * poll carries the latest request, and this navigates to that block. Requests
 * are judged against the mount time, not the first status read, so one that
 * lands before that first read still opens, while one from before this page
 * loaded never jumps on its own.
 */
export function GameOpenBlock() {
  const { data } = useQuery(bridgeStatusSubscription);
  const navigate = useNavigate();
  // newest request already handled; starts at mount so older ones are ignored
  const handledAt = useRef(Date.now());
  const open = data?.openBlock ?? null;

  useEffect(() => {
    if (!open || open.at <= handledAt.current) return;
    handledAt.current = open.at;
    void navigate({ to: "/block/$id", params: { id: String(open.id) } });
  }, [open, navigate]);

  return null;
}
