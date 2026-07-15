import { describe, expect, it } from "vite-plus/test";
import { REFERENCE_DATA_FORMAT_VERSION, referenceDataFormatStatus } from "./data-format.ts";

describe("referenceDataFormatStatus", () => {
  it("accepts reference data imported by the current reader", () => {
    expect(referenceDataFormatStatus(String(REFERENCE_DATA_FORMAT_VERSION), true)).toEqual({
      current: REFERENCE_DATA_FORMAT_VERSION,
      imported: REFERENCE_DATA_FORMAT_VERSION,
      stale: false,
    });
  });

  it("marks unversioned, older, newer, and malformed imports stale", () => {
    expect(referenceDataFormatStatus(undefined, true).stale).toBe(true);
    expect(referenceDataFormatStatus("0", true).stale).toBe(true);
    expect(referenceDataFormatStatus(String(REFERENCE_DATA_FORMAT_VERSION + 1), true).stale).toBe(
      true,
    );
    expect(referenceDataFormatStatus("not-a-version", true).stale).toBe(true);
  });

  it("does not nag an empty project that already needs its initial sync", () => {
    expect(referenceDataFormatStatus(undefined, false).stale).toBe(false);
  });
});
