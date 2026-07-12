import { createFileRoute, redirect } from "@tanstack/react-router";

/** Compatibility redirect for saved links from before Factory became a workspace. */
export const Route = createFileRoute("/whatif")({
  beforeLoad: () => {
    throw redirect({ to: "/factory/scenario", replace: true });
  },
});
