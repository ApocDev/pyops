/** One legend swatch: a colour square + label, used under the recipe grid. */
export function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 ${cls}`} />
      {label}
    </span>
  );
}
