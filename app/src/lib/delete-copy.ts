/**
 * Copy helpers for destructive-action dialogs and toasts (#83). Pure, so the
 * wording — especially pluralization and the block-contents summary — is
 * unit-testable without rendering anything.
 */

/** "3 recipes", "1 goal" — count + pluralized noun (simple `s` plural). */
export function countNoun(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Body copy for the delete-block confirm: names the block and states what
 * its deletion destroys (recipe/goal counts), per #83. */
export function blockDeleteDescription(
  name: string,
  recipeCount: number,
  goalCount: number,
): string {
  const contents =
    recipeCount === 0 && goalCount === 0
      ? "It is empty."
      : `This destroys its ${countNoun(recipeCount, "recipe")} and ${countNoun(goalCount, "goal")}.`;
  return `Delete "${name}"? ${contents} You can undo this afterwards.`;
}

/** The standard post-delete toast message. */
export function deletedMessage(label: string): string {
  return `Deleted "${label}"`;
}
