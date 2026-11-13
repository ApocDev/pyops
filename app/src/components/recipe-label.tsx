/** A recipe's display name, plus a muted second line saying what sets it apart
 * when other recipes share the name ("from Molten iron + Hot air", from
 * lib/recipe-differences.ts). Both lines truncate; the caller sizes the box. */
export function RecipeLabel({
  display,
  differs,
  className = "",
}: {
  display: string;
  differs?: string | null;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 flex-col text-left ${className}`}>
      <span className="truncate">{display}</span>
      {differs && <span className="truncate text-sm text-muted-foreground">{differs}</span>}
    </span>
  );
}
