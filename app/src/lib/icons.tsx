import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, FlaskConical, Fuel, Timer, Zap } from "lucide-react";
import { iconManifestFn, spoilablesFn, type IconManifest, type IconSlot } from "../server/factorio";
import { GoodHover } from "./recipe-card";

/** Spoil time (in game ticks, 60/sec) → a compact human duration: "27s",
 * "2m 30s", "1h 5m". Shared by the icon overlay's title and the item tooltip. */
export function fmtSpoilTime(ticks: number): string {
  const s = Math.round(ticks / 60);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${s}s`;
}

/**
 * Renders Factorio icons from the sprite atlas (manifest comes from a typed
 * server fn; atlas sheets are served from /icons). Each
 * icon is a background-position slice. Manifest keys are `${prototypeType}/${name}`.
 *
 * The manifest loads through react-query on the client; it isn't fetched during SSR.
 */

// Prototype types that are "items" — their icon folder isn't always "item/"
// (modules live under module/, tools under tool/, …), so item-kind lookups
// fall back to a by-name index across all of these.
const ITEM_TYPES = new Set([
  "item",
  "ammo",
  "capsule",
  "gun",
  "module",
  "tool",
  "armor",
  "repair-tool",
  "mining-tool",
  "rail-planner",
  "item-with-entity-data",
  "item-with-label",
  "item-with-inventory",
  "item-with-tags",
  "selection-tool",
  "blueprint",
  "copy-paste-tool",
  "deconstruction-item",
  "upgrade-item",
  "blueprint-book",
  "spidertron-remote",
  "space-platform-starter-pack",
]);

/** Spoilable map (item name → spoil ticks) for spoil-risk UI beyond the icon
 * overlay (#20) — e.g. flagging a block's SURPLUS spoilables, which are the
 * ones that actually sit around long enough to rot. */
export function useSpoilables(): Record<string, number> {
  return useContext(IconCtx).spoil;
}

const IconCtx = createContext<{
  m?: IconManifest;
  itemIdx: Record<string, IconSlot>;
  spoil: Record<string, number>;
}>({
  itemIdx: {},
  spoil: {},
});

const NO_SPOILABLES: Record<string, number> = {};

export function IconProvider({ children }: { children: React.ReactNode }) {
  // Shared react-query entries, so every provider on a page reuses one fetch and
  // a finished data sync (which invalidates every query) swaps in the rebuilt
  // atlas's manifest. A stale manifest over a rebuilt atlas draws wrong sprites.
  const { data: m } = useQuery({
    queryKey: ["iconManifest"],
    queryFn: () => iconManifestFn(),
    staleTime: Infinity,
  });
  // Spoilable items (name → spoil ticks) drive the stopwatch overlay on every
  // spoilable item icon.
  const { data: spoil = NO_SPOILABLES } = useQuery({
    queryKey: ["spoilables"],
    queryFn: () => spoilablesFn(),
    staleTime: Infinity,
  });
  const itemIdx = useMemo(() => {
    const idx: Record<string, IconSlot> = {};
    if (m) {
      for (const [key, slot] of Object.entries(m.icons)) {
        const i = key.indexOf("/");
        const type = key.slice(0, i);
        const name = key.slice(i + 1);
        if (ITEM_TYPES.has(type) && !(name in idx)) idx[name] = slot;
      }
    }
    return idx;
  }, [m]);
  return <IconCtx.Provider value={{ m, itemIdx, spoil }}>{children}</IconCtx.Provider>;
}

/** Icon size tokens → CSS vars defined in styles.css (:root --icon-*). */
export type IconSize = "xs" | "sm" | "md" | "lg";
const ICON_VAR: Record<IconSize, string> = {
  xs: "var(--icon-xs)",
  sm: "var(--icon-sm)",
  md: "var(--icon-md)",
  lg: "var(--icon-lg)",
};

/** `quality` draws a quality's own sprite (the tier pickers); it has no hover card. */
export type IconKind = "item" | "fluid" | "recipe" | "entity" | "technology" | "quality";

export type IconProps = {
  kind: IconKind;
  /** A good's quality rides in its key (`iron-plate@rare`, lib/quality.ts). */
  name: string;
  /** Quality of a machine or module, which has no quality key (#267). */
  quality?: string | null;
  size?: IconSize;
  noTitle?: boolean;
  title?: string | null;
};

/** Splits a quality key (`iron-plate@rare`) into the good and its quality when
 * the atlas has that quality's sprite. Any other name has no quality. */
function splitIconQuality(name: string, icons: IconManifest["icons"] | undefined) {
  const at = name.lastIndexOf("@");
  const quality = at > 0 ? name.slice(at + 1) : "";
  return quality && icons?.[`quality/${quality}`]
    ? { name: name.slice(0, at), quality }
    : { name, quality: null };
}

/** The default icon: renders the sprite wrapped in a rich hover card for its
 * `kind` (item/fluid → ItemCard, recipe → RecipeCard, technology → TechCard,
 * entity → EntityCard). Pass `noHover` to opt a specific place out — e.g. an
 * icon inside a row that already carries its own hover/tooltip, a decorative
 * glyph, or the pseudo-goods. The hover supersedes the native `title`, so the
 * bare `title`/`noTitle` props only apply when `noHover` is set. */
export function Icon(props: IconProps & { noHover?: boolean; extraText?: React.ReactNode }) {
  const { noHover, extraText, ...rest } = props;
  const { m } = useContext(IconCtx);
  // pseudo-goods (heat/electricity/fluid fuel) have no prototype/detail to card.
  const noCard =
    rest.name === "pyops-electricity" ||
    rest.name === "pyops-heat" ||
    rest.name === "pyops-fluid-fuel";
  if (noHover || noCard || rest.kind === "quality") return <RawIcon {...rest} />;
  // the card describes the good itself; its quality is the icon's badge
  const card = splitIconQuality(rest.name, m?.icons).name;
  return (
    <GoodHover kind={rest.kind} name={card} extraText={extraText}>
      <RawIcon {...rest} noTitle />
    </GoodHover>
  );
}

/** The bare sprite, no hover card. Used by the hover cards themselves (so a
 * card's own icons don't spawn nested cards) and anywhere `Icon` opts out. */
export function RawIcon({
  kind,
  name: rawName,
  quality: qualityProp,
  size = "sm",
  noTitle = false,
  title,
}: IconProps) {
  const { m, itemIdx, spoil } = useContext(IconCtx);
  const split = splitIconQuality(rawName, m?.icons);
  const name = split.name;
  const quality = qualityProp ?? split.quality;
  const v = ICON_VAR[size];
  const base: React.CSSProperties = {
    display: "inline-block",
    width: v,
    height: v,
    verticalAlign: "middle",
    flex: "0 0 auto",
  };
  // Spoilable items get a small stopwatch badge in the corner; the spoil time
  // rides along in the title (and the rich item tooltip shows it too).
  const spoilTicks = kind === "item" ? spoil[name] : undefined;
  const spoilSuffix = spoilTicks != null ? ` — spoils in ${fmtSpoilTime(spoilTicks)}` : "";
  // Wrap an icon span in a relative container carrying the stopwatch badge.
  const withSpoil = (el: React.ReactNode) =>
    spoilTicks == null ? (
      el
    ) : (
      <span style={{ ...base, position: "relative" }}>
        {el}
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: "-3px",
            bottom: "-3px",
            display: "inline-flex",
            borderRadius: "9999px",
            background: "rgba(0,0,0,0.75)",
            padding: "1px",
            pointerEvents: "none",
          }}
        >
          <Timer
            color="var(--warning)"
            strokeWidth={2.75}
            style={{ width: `calc(${v} * 0.5)`, height: `calc(${v} * 0.5)` }}
          />
        </span>
      </span>
    );
  // the electricity / heat / fluid-fuel pseudo-goods have no real prototype — render an icon
  if (name === "pyops-electricity" || name === "pyops-heat" || name === "pyops-fluid-fuel") {
    const heat = name === "pyops-heat";
    const fuel = name === "pyops-fluid-fuel";
    const Glyph = heat ? Flame : fuel ? Fuel : Zap;
    return (
      <span
        title={
          noTitle ? undefined : (title ?? (heat ? "heat" : fuel ? "fluid fuel" : "electricity"))
        }
        style={{ ...base, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <Glyph
          color={heat ? "var(--destructive)" : fuel ? "var(--info)" : "var(--warning)"}
          style={{ width: `calc(${v} * 0.85)`, height: `calc(${v} * 0.85)` }}
        />
      </span>
    );
  }
  if (!m) return <span style={base} />;

  // synthetic recipes (mine-X, boil-X-250, generate-X, spoil-X, pump-X) have no
  // recipe/ sprite — fall back to the subject's item/entity/fluid icon. Fluid
  // fuel conversions are also synthetic, but their `burn-fluid-X` subject is
  // known to be a fluid (and `fluid-` is part of the recipe prefix, not its id).
  const synthetic = /^(mine|pump|spoil|boil|generate)-(.+?)(?:-\d+)?$/.exec(name);
  const burnedFluid = /^burn-fluid-(.+)$/.exec(name)?.[1];
  // Research borrows its subject's sprite too: a `research-<pack>` recipe and the
  // `pyops-research-<pack>` good it makes both draw the PACK, badged. They are
  // deliberately one good per pack (a shared research pool would let the solver
  // swap a cheap pack for an expensive one), so the icon has to say which pack —
  // a generic glyph would render all eleven identically and hide the only
  // distinction that matters.
  const researchPack =
    kind === "recipe" ? /^research-(.+)$/.exec(name)?.[1] : /^pyops-research-(.+)$/.exec(name)?.[1];
  const badge = burnedFluid
    ? { key: "fluid-fuel", Glyph: Fuel, color: "var(--info)" }
    : researchPack
      ? { key: "research", Glyph: FlaskConical, color: "var(--info)" }
      : null;
  const withBadge = (el: React.ReactNode) =>
    badge ? (
      <span style={{ ...base, position: "relative" }}>
        {el}
        <span
          aria-hidden
          data-icon-badge={badge.key}
          style={{
            position: "absolute",
            right: "-3px",
            bottom: "-3px",
            display: "inline-flex",
            borderRadius: "9999px",
            background: "rgba(0,0,0,0.75)",
            padding: "1px",
            pointerEvents: "none",
          }}
        >
          <badge.Glyph
            color={badge.color}
            strokeWidth={2.75}
            style={{ width: `calc(${v} * 0.5)`, height: `calc(${v} * 0.5)` }}
          />
        </span>
      </span>
    ) : (
      el
    );
  // generate-heat-<reactor> → the reactor entity (the "heat-" is the product, not the subject)
  const subject = synthetic?.[2]?.replace(/^heat-/, "");
  const slot =
    name === "pyops-electricity"
      ? m.icons["ammo-category/electric"]
      : kind === "recipe"
        ? (m.icons[`recipe/${name}`] ??
          (burnedFluid
            ? m.icons[`fluid/${burnedFluid}`]
            : researchPack
              ? (itemIdx[researchPack] ?? m.icons[`item/${researchPack}`])
              : subject
                ? (itemIdx[subject] ??
                  m.icons[`entity/${subject}`] ??
                  m.icons[`fluid/${subject}`] ??
                  m.icons[`resource/${subject}`])
                : undefined))
        : kind === "fluid"
          ? // the research goods are synthetic fluids with no sprite of their own
            (m.icons[`fluid/${name}`] ??
            (researchPack ? (itemIdx[researchPack] ?? m.icons[`item/${researchPack}`]) : undefined))
          : kind === "entity"
            ? (m.icons[`entity/${name}`] ?? itemIdx[name])
            : kind === "technology"
              ? m.icons[`technology/${name}`]
              : kind === "quality"
                ? m.icons[`quality/${name}`]
                : (itemIdx[name] ?? m.icons[`item/${name}`]);

  if (!slot) {
    return withSpoil(
      <span
        title={noTitle ? undefined : `${title ?? name}${spoilSuffix} — no icon`}
        style={{ ...base, background: "var(--muted)" }}
      />,
    );
  }
  // Atlas slice scales with the token: express positions/size in cell-multiples of
  // the CSS var so the sprite tracks whatever --icon-* resolves to.
  const cells = m.atlasSize / m.cell;
  const slice = (at: IconSlot, size: string): React.CSSProperties => ({
    backgroundImage: `url(/icons/${m.sheets[at.s]})`,
    backgroundPosition: `calc(${size} * ${-at.x / m.cell}) calc(${size} * ${-at.y / m.cell})`,
    backgroundSize: `calc(${size} * ${cells}) calc(${size} * ${cells})`,
  });
  // A quality above normal draws the quality's own sprite in the bottom-left
  // corner, as the game does (#267). The spoil and research badges sit
  // bottom-right, so they never overlap it.
  const qualitySlot = quality && quality !== "normal" ? m.icons[`quality/${quality}`] : undefined;
  const badgeSize = `calc(${v} * 0.5)`;
  const withQuality = (el: React.ReactNode) =>
    qualitySlot ? (
      <span style={{ ...base, position: "relative" }} data-quality={quality}>
        {el}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "-2px",
            bottom: "-2px",
            width: badgeSize,
            height: badgeSize,
            filter: "drop-shadow(0 0 1px rgba(0,0,0,0.9))",
            pointerEvents: "none",
            ...slice(qualitySlot, badgeSize),
          }}
        />
      </span>
    ) : (
      el
    );
  return withQuality(
    withSpoil(
      withBadge(
        <span
          title={noTitle ? undefined : `${title ?? name}${spoilSuffix}`}
          style={{ ...base, ...slice(slot, v) }}
        />,
      ),
    ),
  );
}
