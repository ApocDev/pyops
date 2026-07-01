/** Strip Factorio rich-text markup from a localised string.
 *
 * Factorio descriptions embed inline tags — `[img=turd]`, `[item=copper-ore]`,
 * `[color=1,1,1]…[/color]`, `[font=default-semibold]…[/font]`, `[/color]`, etc.
 * These are meaningless as plain text (in the assistant, in a tooltip), so we drop
 * the tags and keep their inner text. Newlines are preserved (they mark paragraph
 * breaks in the source); horizontal whitespace is collapsed. */
export function stripRichText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\[\.?\/?[a-z][^\]]*\]/gi, "") // [img=x] [color=..] [/color] [font=..] [.recipe=..] …
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
