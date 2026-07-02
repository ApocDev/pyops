import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Flame, Timer, Zap } from "lucide-react";
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
 * The manifest loads CLIENT-ONLY (useEffect) so it isn't fetched during SSR.
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

let cache: IconManifest | null = null;
let inflight: Promise<IconManifest> | null = null;
function loadManifest(): Promise<IconManifest> {
  if (cache) return Promise.resolve(cache);
  inflight ??= iconManifestFn().then((m) => (cache = m));
  return inflight;
}

// Spoilable items (name → spoil ticks) load alongside the manifest, once, and
// drive the stopwatch overlay on every spoilable item icon.
let spoilCache: Record<string, number> | null = null;
let spoilInflight: Promise<Record<string, number>> | null = null;
function loadSpoilables(): Promise<Record<string, number>> {
  if (spoilCache) return Promise.resolve(spoilCache);
  spoilInflight ??= spoilablesFn().then((s) => (spoilCache = s));
  return spoilInflight;
}

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

export function IconProvider({ children }: { children: React.ReactNode }) {
  const [m, setM] = useState<IconManifest | undefined>(cache ?? undefined);
  const [spoil, setSpoil] = useState<Record<string, number>>(spoilCache ?? {});
  useEffect(() => {
    if (!m)
      loadManifest()
        .then(setM)
        .catch((e) => console.error("[icons]", e));
  }, [m]);
  useEffect(() => {
    if (!spoilCache)
      loadSpoilables()
        .then(setSpoil)
        .catch((e) => console.error("[icons:spoil]", e));
  }, []);
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

export type IconKind = "item" | "fluid" | "recipe" | "entity" | "technology";

export type IconProps = {
  kind: IconKind;
  name: string;
  size?: IconSize;
  noTitle?: boolean;
  title?: string | null;
};

/** The default icon: renders the sprite wrapped in a rich hover card for its
 * `kind` (item/fluid → ItemCard, recipe → RecipeCard, technology → TechCard,
 * entity → EntityCard). Pass `noHover` to opt a specific place out — e.g. an
 * icon inside a row that already carries its own hover/tooltip, a decorative
 * glyph, or the pseudo-goods. The hover supersedes the native `title`, so the
 * bare `title`/`noTitle` props only apply when `noHover` is set. */
export function Icon(props: IconProps & { noHover?: boolean }) {
  const { noHover, ...rest } = props;
  // pseudo-goods (heat/electricity) have no prototype/detail to card.
  const noCard = rest.name === "pyops-electricity" || rest.name === "pyops-heat";
  if (noHover || noCard) return <RawIcon {...rest} />;
  return (
    <GoodHover kind={rest.kind} name={rest.name}>
      <RawIcon {...rest} noTitle />
    </GoodHover>
  );
}

/** The bare sprite, no hover card. Used by the hover cards themselves (so a
 * card's own icons don't spawn nested cards) and anywhere `Icon` opts out. */
export function RawIcon({ kind, name, size = "sm", noTitle = false, title }: IconProps) {
  const { m, itemIdx, spoil } = useContext(IconCtx);
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
  // the electricity / heat pseudo-goods have no real prototype — render an icon
  if (name === "pyops-electricity" || name === "pyops-heat") {
    const heat = name === "pyops-heat";
    const Glyph = heat ? Flame : Zap;
    return (
      <span
        title={noTitle ? undefined : (title ?? (heat ? "heat" : "electricity"))}
        style={{ ...base, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <Glyph
          color={heat ? "var(--destructive)" : "var(--warning)"}
          style={{ width: `calc(${v} * 0.85)`, height: `calc(${v} * 0.85)` }}
        />
      </span>
    );
  }
  if (!m) return <span style={base} />;

  // synthetic recipes (mine-X, boil-X-250, generate-X, spoil-X, pump-X) have no
  // recipe/ sprite — fall back to the subject's item/entity/fluid icon
  const synthetic = /^(mine|pump|spoil|boil|generate)-(.+?)(?:-\d+)?$/.exec(name);
  // generate-heat-<reactor> → the reactor entity (the "heat-" is the product, not the subject)
  const subject = synthetic?.[2]?.replace(/^heat-/, "");
  const slot =
    name === "pyops-electricity"
      ? m.icons["ammo-category/electric"]
      : kind === "recipe"
        ? (m.icons[`recipe/${name}`] ??
          (subject
            ? (itemIdx[subject] ??
              m.icons[`entity/${subject}`] ??
              m.icons[`fluid/${subject}`] ??
              m.icons[`resource/${subject}`])
            : undefined))
        : kind === "fluid"
          ? m.icons[`fluid/${name}`]
          : kind === "entity"
            ? (m.icons[`entity/${name}`] ?? itemIdx[name])
            : kind === "technology"
              ? m.icons[`technology/${name}`]
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
  return withSpoil(
    <span
      title={noTitle ? undefined : `${title ?? name}${spoilSuffix}`}
      style={{
        ...base,
        backgroundImage: `url(/icons/${m.sheets[slot.s]})`,
        backgroundPosition: `calc(${v} * ${-slot.x / m.cell}) calc(${v} * ${-slot.y / m.cell})`,
        backgroundSize: `calc(${v} * ${cells}) calc(${v} * ${cells})`,
      }}
    />,
  );
}
