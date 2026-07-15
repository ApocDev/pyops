/**
 * Version of PyOps' normalized Factorio reference-data interpretation.
 *
 * Bump this whenever an importer or synthesis change means an existing project's
 * reference tables must be rebuilt from the game dump. This is deliberately
 * separate from SQLite migrations: migrations describe storage shape, while
 * this version describes the meaning of imported rows.
 */
export const REFERENCE_DATA_FORMAT_VERSION = 1;
export const REFERENCE_DATA_FORMAT_META_KEY = "data_format_version";

export type ReferenceDataFormatStatus = {
  current: number;
  imported: number | null;
  stale: boolean;
};

/** Missing versions represent imports made before format tracking existed. Empty
 * projects are setup cases, not stale imports, so they do not trigger drift. */
export function referenceDataFormatStatus(
  stored: string | null | undefined,
  hasReferenceData: boolean,
): ReferenceDataFormatStatus {
  const parsed = stored == null ? Number.NaN : Number(stored);
  const imported = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  return {
    current: REFERENCE_DATA_FORMAT_VERSION,
    imported,
    stale: hasReferenceData && imported !== REFERENCE_DATA_FORMAT_VERSION,
  };
}
