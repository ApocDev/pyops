/** Temperature-qualified boundary flow shared by block persistence and the
 * factory solvers. Factorio still has one canonical fluid prototype; this is
 * planner identity attached to a particular flow. */
export type TemperatureMode = "exact" | "range";

export type TemperatureQualifier = {
  temperatureMode?: TemperatureMode | null;
  minTemp?: number | null;
  maxTemp?: number | null;
};

export type QualifiedGood = TemperatureQualifier & {
  item: string;
  kind: string;
};

const SEP = "\u0002temp\u0002";

const bound = (value: number | null | undefined, fallback: string) =>
  value == null ? fallback : String(value);

/** Opaque factory-LP identity. UI and database rows keep the canonical item
 * name plus structured qualifier; only in-memory solver maps use this key. */
export function qualifiedGoodKey(good: QualifiedGood): string {
  if (good.kind !== "fluid" || !good.temperatureMode) return good.item;
  return `${good.item}${SEP}${good.temperatureMode}${SEP}${bound(good.minTemp, "-")}${SEP}${bound(good.maxTemp, "+")}`;
}

export function baseGoodName(key: string): string {
  const index = key.indexOf(SEP);
  return index < 0 ? key : key.slice(0, index);
}

export function qualifierFromKey(key: string): TemperatureQualifier | null {
  const index = key.indexOf(SEP);
  if (index < 0) return null;
  const [mode, min, max] = key.slice(index + SEP.length).split(SEP);
  if (mode !== "exact" && mode !== "range") return null;
  const parse = (value: string | undefined) => {
    if (value == null || value === "-" || value === "+") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return { temperatureMode: mode, minTemp: parse(min), maxTemp: parse(max) };
}

export function exactTemperature(key: string): number | null {
  const qualifier = qualifierFromKey(key);
  if (qualifier?.temperatureMode !== "exact") return null;
  return qualifier.minTemp ?? null;
}

export function acceptsTemperature(key: string, temperature: number): boolean {
  const qualifier = qualifierFromKey(key);
  if (!qualifier) return true;
  const lo = qualifier.minTemp ?? Number.NEGATIVE_INFINITY;
  const hi = qualifier.maxTemp ?? Number.POSITIVE_INFINITY;
  return temperature >= lo && temperature <= hi;
}

export function isTemperatureKey(key: string): boolean {
  return key.includes(SEP);
}
