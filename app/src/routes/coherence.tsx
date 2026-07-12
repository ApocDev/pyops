import { createFileRoute, redirect } from "@tanstack/react-router";

/** Compatibility redirect for saved links from before Factory became a workspace. */
export const Route = createFileRoute("/coherence")({
  beforeLoad: () => {
    throw redirect({ to: "/factory/connections", replace: true });
  },
});
