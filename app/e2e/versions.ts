import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Versions derived from their sources of truth so release/protocol bumps can't
 * silently break the bridge fixtures (#105). protocol.ts is the wire contract;
 * version.txt is the release-please-managed product version.
 */

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const PROTOCOL_VERSION = Number(
  /export const PROTOCOL_VERSION = (\d+)/.exec(
    readFileSync(here("../src/server/bridge/protocol.ts"), "utf8"),
  )![1],
);

export const APP_VERSION = readFileSync(here("../../version.txt"), "utf8").trim();
