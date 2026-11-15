import { ArrowRight } from "lucide-react";
import { RawIcon } from "../../lib/icons";
import { NORMAL_QUALITY } from "../../lib/quality";
import { useQualityLadder } from "../../lib/use-quality-ladder";
import type { RowQuality } from "../../db/schema";

/** A recipe row's quality range (#267): the lowest and highest quality it runs
 * at. The row renders it only when it has a quality setting, and it stays
 * hidden when the project's data has no quality (a block imported from a
 * quality project keeps its setting). Click to open the row's quality editor.
 * Amber when the quality setting does nothing or asks for a quality the
 * horizon hasn't unlocked. */
export function RowQualityPill({
  setting,
  warn,
  onOpen,
}: {
  setting: RowQuality;
  warn: boolean;
  onOpen: () => void;
}) {
  const { ladder, has } = useQualityLadder();
  if (!has) return null;
  const lo = setting.min ?? NORMAL_QUALITY;
  const hi = setting.max ?? lo;
  const name = (q: string) => ladder.find((step) => step.name === q)?.display ?? q;
  const label = lo === hi ? `Runs at ${name(lo)}` : `Runs at ${name(lo)} to ${name(hi)}`;
  return (
    // Raw button on purpose: a compact chip inside the dense recipe cell, like
    // ModulesChip — the Button primitive's h-8 box would break the row density.
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}. Edit quality`}
      title={warn ? `${label}. This quality setting needs a look.` : label}
      className={`mt-1 flex w-fit items-center gap-1 border px-1.5 py-0.5 text-sm hover:bg-accent ${
        warn ? "border-warning/60 text-warning" : "border-border text-muted-foreground"
      }`}
    >
      <RawIcon kind="quality" name={lo} size="xs" noTitle />
      {hi !== lo && (
        <>
          <ArrowRight className="size-3" aria-hidden />
          <RawIcon kind="quality" name={hi} size="xs" noTitle />
        </>
      )}
    </button>
  );
}
