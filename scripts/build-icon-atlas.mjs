#!/usr/bin/env node
// One-off test: pack Factorio's dumped icon sprites into content-hash-deduped
// atlas sheets + a (type/name)->slot manifest.
//
// Usage:
//   node build-icon-atlas.mjs [srcDir] [outDir] [cellPx]
//   srcDir  default ~/.factorio/script-output   (output of `factorio --dump-icon-sprites`)
//   outDir  default ./atlas-out
//   cellPx  default 64
//
// Layout: uniform grid, CELL x CELL cells in a 4096x4096 sheet. No bin-packing
// (icons are square), so placement is trivial and deterministic.

import { readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname } from "node:path";
import sharp from "sharp";

const HOME = process.env.HOME ?? "";
const SRC = process.argv[2] ?? join(HOME, ".factorio", "script-output");
const OUT = process.argv[3] ?? new URL("./atlas-out", import.meta.url).pathname;
const CELL = Number(process.argv[4] ?? 64);
const SHEET = 4096;
const COLS = Math.floor(SHEET / CELL);
const PER_SHEET = COLS * COLS;

const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function collectPngs(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await collectPngs(p)));
    else if (ent.isFile() && p.toLowerCase().endsWith(".png")) out.push(p);
  }
  return out;
}

console.log(`src:  ${SRC}`);
console.log(`out:  ${OUT}`);
console.log(`cell: ${CELL}px  (${COLS}x${COLS} = ${PER_SHEET} per ${SHEET}^2 sheet)\n`);

const files = await collectPngs(SRC);
console.log(`[${ms()}] found ${files.length} png files`);

// key = "type/name" (relative path minus .png); dedup by raw file-byte hash
const keyToHash = new Map();
const hashToFile = new Map();
for (const f of files) {
  const rel = relative(SRC, f).split("\\").join("/");
  const key = rel.slice(0, rel.length - extname(rel).length);
  const hash = createHash("sha1").update(readFileSync(f)).digest("hex");
  keyToHash.set(key, hash);
  if (!hashToFile.has(hash)) hashToFile.set(hash, f);
}
const uniqueHashes = [...hashToFile.keys()];
const sheetCount = Math.ceil(uniqueHashes.length / PER_SHEET);
console.log(
  `[${ms()}] ${keyToHash.size} keys -> ${uniqueHashes.length} unique images (${(
    (1 - uniqueHashes.length / keyToHash.size) *
    100
  ).toFixed(0)}% dedup) -> ${sheetCount} sheet(s)`,
);

await mkdir(OUT, { recursive: true });

// build + encode one sheet at a time (cap peak memory at ~one 64MB RGBA buffer)
const sheetFiles = [];
let skipped = 0;
for (let s = 0; s < sheetCount; s++) {
  const buf = Buffer.alloc(SHEET * SHEET * 4); // transparent RGBA
  const start = s * PER_SHEET;
  const end = Math.min(start + PER_SHEET, uniqueHashes.length);
  for (let i = start; i < end; i++) {
    const idx = i - start;
    const cx = (idx % COLS) * CELL;
    const cy = Math.floor(idx / COLS) * CELL;
    try {
      const raw = await sharp(hashToFile.get(uniqueHashes[i]))
        .resize(CELL, CELL, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .raw()
        .toBuffer();
      for (let row = 0; row < CELL; row++) {
        const srcStart = row * CELL * 4;
        raw.copy(buf, ((cy + row) * SHEET + cx) * 4, srcStart, srcStart + CELL * 4);
      }
    } catch (err) {
      skipped++;
    }
  }
  const name = `atlas-${s}.png`;
  await sharp(buf, { raw: { width: SHEET, height: SHEET, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, name));
  sheetFiles.push(name);
  console.log(`[${ms()}] wrote ${name} (slots ${start}..${end - 1})`);
}

// manifest: every logical key -> its slot (dedup means many keys share a slot)
const slotOf = new Map(uniqueHashes.map((h, i) => [h, i]));
const icons = {};
for (const [key, hash] of keyToHash) {
  const slot = slotOf.get(hash);
  const idx = slot % PER_SHEET;
  icons[key] = {
    s: Math.floor(slot / PER_SHEET),
    x: (idx % COLS) * CELL,
    y: Math.floor(idx / COLS) * CELL,
  };
}
const manifest = {
  cell: CELL,
  atlasSize: SHEET,
  sheets: sheetFiles,
  counts: { keys: keyToHash.size, unique: uniqueHashes.length, skipped },
  icons,
};
await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest));

// report output sizes
let totalOut = 0;
for (const f of [...sheetFiles, "manifest.json"]) {
  const sz = (await stat(join(OUT, f))).size;
  totalOut += sz;
  console.log(`   ${f.padEnd(14)} ${(sz / 1048576).toFixed(2)} MB`);
}
console.log(
  `\n[${ms()}] done. ${sheetFiles.length} sheet(s), ${(totalOut / 1048576).toFixed(1)} MB total${
    skipped ? `, ${skipped} skipped` : ""
  }`,
);
