import { readFileSync } from "node:fs";

/**
 * Parse Factorio's `data-raw-dump.json` one top-level prototype type at a time.
 *
 * A large modpack's dump can exceed V8's max string length (~512 MB), so
 * `JSON.parse(readFileSync(path, "utf8"))` fails with "Cannot create a string
 * longer than 0x1fffffe8 characters". This keeps the file as bytes, finds where
 * each type's value starts and ends, and decodes + parses only that slice.
 * Each type is far below the limit (the largest is tens of MB).
 *
 * The byte scan is UTF-8 safe: the structural characters it looks for are all
 * ASCII, and every byte of a multi-byte UTF-8 sequence is >= 0x80.
 */
export function readDump(path: string): Record<string, Record<string, any>> {
  return parseByTopLevelKey(readFileSync(path));
}

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c;
const COLON = 0x3a;
const COMMA = 0x2c;
const OPEN_OBJ = 0x7b; // {
const CLOSE_OBJ = 0x7d; // }
const OPEN_ARR = 0x5b; // [
const CLOSE_ARR = 0x5d; // ]

/** Parse a JSON object whose total size may exceed V8's string limit, as long
 * as each top-level value fits. Exported for tests. */
export function parseByTopLevelKey(buf: Buffer): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {};
  let i = skipWs(buf, 0);
  if (buf[i] !== OPEN_OBJ) throw new Error("data-raw-dump: expected a top-level object");
  i = skipWs(buf, i + 1);
  if (buf[i] === CLOSE_OBJ) return out;

  for (;;) {
    const keyEnd = stringEnd(buf, i);
    const key = JSON.parse(buf.toString("utf8", i, keyEnd)) as string;
    i = skipWs(buf, keyEnd);
    if (buf[i] !== COLON) throw new Error(`data-raw-dump: expected ':' after "${key}"`);
    const start = skipWs(buf, i + 1);
    const end = valueEnd(buf, start);
    out[key] = JSON.parse(buf.toString("utf8", start, end));
    i = skipWs(buf, end);
    if (buf[i] === COMMA) i = skipWs(buf, i + 1);
    else if (buf[i] === CLOSE_OBJ) return out;
    else throw new Error(`data-raw-dump: unexpected byte after "${key}"`);
  }
}

function skipWs(buf: Buffer, i: number): number {
  while (
    i < buf.length &&
    (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)
  )
    i++;
  return i;
}

/** Index just past the closing quote of the string starting at `i`. */
function stringEnd(buf: Buffer, i: number): number {
  if (buf[i] !== QUOTE) throw new Error("data-raw-dump: expected a string");
  for (i++; i < buf.length; i++) {
    if (buf[i] === BACKSLASH) i++;
    else if (buf[i] === QUOTE) return i + 1;
  }
  throw new Error("data-raw-dump: unterminated string");
}

/** Index just past the value starting at `i`: a string, or a balanced
 * object/array, or a scalar that runs up to the next ',' or '}'. */
function valueEnd(buf: Buffer, i: number): number {
  if (buf[i] === QUOTE) return stringEnd(buf, i);
  if (buf[i] !== OPEN_OBJ && buf[i] !== OPEN_ARR) {
    while (i < buf.length && buf[i] !== COMMA && buf[i] !== CLOSE_OBJ) i++;
    return i;
  }
  let depth = 0;
  for (; i < buf.length; i++) {
    const c = buf[i];
    if (c === QUOTE) i = stringEnd(buf, i) - 1;
    else if (c === OPEN_OBJ || c === OPEN_ARR) depth++;
    else if ((c === CLOSE_OBJ || c === CLOSE_ARR) && --depth === 0) return i + 1;
  }
  throw new Error("data-raw-dump: unbalanced brackets");
}
