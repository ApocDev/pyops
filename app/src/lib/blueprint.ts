/**
 * Factorio 2.0 blueprint building + string encoding, pure and browser-safe.
 *
 * The JSON shape mirrors the one the companion mod's request-combinator
 * generator uses (mod/combinator.lua) — one constant combinator whose logistic
 * sections carry unified signals; `quality: "normal"` is required on EVERY
 * filter (even fluids/virtuals) or the count imports as 0. A blueprint string
 * is `"0" + base64(zlib(JSON))`, built here with the platform
 * CompressionStream — no Node deps, so this works client-side.
 */

/** Factorio's 2.0 blueprint format version (major 2, minor 0). */
const BLUEPRINT_VERSION = 562949957812224;

export type SignalFilter = {
  name: string;
  type: "item" | "fluid" | "virtual";
  /** signed count — negative is the "request" convention */
  count: number;
};

/** One logistic section of a constant combinator: its own row-group in the GUI
 * with its own enable checkbox. `active: false` ships it toggled off — the
 * values stay visible as reference but don't emit on the wire. */
export type SignalSection = {
  signals: SignalFilter[];
  active?: boolean;
};

/** One constant combinator holding the given sections, as a blueprint object. */
export function constantCombinatorBlueprint(label: string, sections: SignalSection[]): unknown {
  const nonEmpty = sections.filter((s) => s.signals.length > 0);
  const first = nonEmpty[0]?.signals[0];
  return {
    blueprint: {
      item: "blueprint",
      label,
      ...(first ? { icons: [{ signal: { type: first.type, name: first.name }, index: 1 }] } : {}),
      entities: [
        {
          entity_number: 1,
          name: "constant-combinator",
          position: { x: 0.5, y: 0.5 },
          control_behavior: {
            sections: {
              sections: nonEmpty.map((s, si) => ({
                index: si + 1,
                ...(s.active === false ? { active: false } : {}),
                filters: s.signals.map((f, fi) => ({
                  index: fi + 1,
                  name: f.name,
                  type: f.type,
                  quality: "normal",
                  comparator: "=",
                  count: Math.round(f.count),
                })),
              })),
            },
          },
        },
      ],
      version: BLUEPRINT_VERSION,
    },
  };
}

async function pipeThrough(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(stream),
  ).arrayBuffer();
  return new Uint8Array(await out);
}

/** Encode a blueprint object as an importable blueprint string. */
export async function encodeBlueprint(bp: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(bp));
  const deflated = await pipeThrough(json, new CompressionStream("deflate"));
  let bin = "";
  for (const b of deflated) bin += String.fromCharCode(b);
  return "0" + btoa(bin);
}

/** Decode a blueprint string back to its object — the round-trip check. */
export async function decodeBlueprint(str: string): Promise<unknown> {
  if (!str.startsWith("0")) throw new Error("unsupported blueprint-string version");
  const bin = atob(str.slice(1));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const inflated = await pipeThrough(bytes, new DecompressionStream("deflate"));
  return JSON.parse(new TextDecoder().decode(inflated)) as unknown;
}
