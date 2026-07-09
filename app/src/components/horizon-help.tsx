import { HelpButton } from "./help-drawer";

/** The planning-horizon docs drawer — shared by the header dialog and the
 * Settings card so the concept is explained once, in one place, instead of a
 * paragraph above the controls. */
export function HorizonHelpButton({ className }: { className?: string }) {
  return (
    <HelpButton title="Planning horizon" className={className}>
      <p>
        The horizon caps what the planner is allowed to use. It applies everywhere a recipe can be
        chosen: blocks, the recipe picker, and the assistant.
      </p>
      <p>
        <b className="text-foreground">Now</b> — only recipes reachable with the science packs you
        produce and your current TURD choices. A recipe counts as available when every pack its
        research needs is one you ticked. The explicit completed-research list supplements that
        pack-based horizon for one-off techs. While the game is linked, researched techs sync live
        and Now tracks your save automatically.
      </p>
      <p>
        <b className="text-foreground">Future</b> — everything is available; the planner flags what
        would still need unlocking. Use it to sketch end-game chains.
      </p>
      <p>
        <b className="text-foreground">Up to target</b> — pick a good you're building toward;
        everything unlocked by its tech and that tech's prerequisites is allowed, and nothing
        beyond. Plan ahead to a goal without the solver reaching for far-future tech.
      </p>
      <p>
        <b className="text-foreground">Mining productivity</b> — a flat percent bonus applied to
        mining recipes. Leave it blank to derive it from researched techs; recipe-productivity
        bonuses always come from the exact synced techs.
      </p>
    </HelpButton>
  );
}
