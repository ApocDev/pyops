import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { recomputeCostsFn } from "../../server/factorio";

/** Shown when the stored cost analysis predates the explorer's flow/waste
 * measures (#97): recipes still rank by execution cost, and one click brings
 * the ranking up to date (the same recompute a data sync runs). */
export function FlowStaleCallout() {
  const qc = useQueryClient();
  const recompute = useMutation({
    mutationFn: () => recomputeCostsFn(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["browseDetail"] }),
  });
  return (
    <Callout
      tone="info"
      className="mb-4"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
        >
          {recompute.isPending ? "computing…" : "compute now"}
        </Button>
      }
    >
      Recipe ranking (economy flow + waste) hasn&apos;t been computed for this data yet — recipes
      sort by cost alone until then.
      {recompute.isError && (
        <span className="text-destructive"> Recompute failed — try again.</span>
      )}
    </Callout>
  );
}
