/**
 * Icon-atlas builder: pack Factorio's dumped icon sprites (the output of
 * `factorio --dump-icon-sprites`) into content-hash-deduped atlas sheets plus a
 * `(type/name) -> slot` manifest. Called in-process by the data sync (`dump.ts`).
 *
 * Layout: a uniform grid of CELL x CELL cells in a 4096x4096 sheet. Icons are
 * square, so placement is trivial and deterministic — no bin-packing. Identical
 * sprites (by file-byte hash) share one slot, so many keys map to the same cell.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import sharp from "sharp";

const SHEET = 4096;

export type IconSlot = { s: number; x: number; y: number };

export type AtlasManifest = {
  cell: number;
  atlasSize: number;
  sheets: string[];
  counts: { keys: number; unique: number; skipped: number };
  icons: Record<string, IconSlot>;
};

export type AtlasResult = AtlasManifest & { ms: number };

type BuildOpts = {
  /** Source dir of dumped sprites (recursively scanned for *.png). */
  src: string;
  /** Output dir for the sheets + manifest.json (created if missing). */
  out: string;
  /** Cell size in px (default 64). */
  cell?: number;
  /** Optional progress sink (the sync forwards these into its log). */
  onLog?: (msg: string) => void;
};

async function collectPngs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await collectPngs(p)));
    else if (ent.isFile() && p.toLowerCase().endsWith(".png")) out.push(p);
  }
  return out;
}

export async function buildIconAtlas({
  src,
  out,
  cell = 64,
  onLog,
}: BuildOpts): Promise<AtlasResult> {
  const t0 = Date.now();
  const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log = (m: string) => onLog?.(m);
  const cols = Math.floor(SHEET / cell);
  const perSheet = cols * cols;

  const files = await collectPngs(src);
  log(`[${ms()}] found ${files.length} png files`);

  // key = "type/name" (relative path minus .png); dedup by raw file-byte hash
  const keyToHash = new Map<string, string>();
  const hashToFile = new Map<string, string>();
  for (const f of files) {
    const rel = relative(src, f).split("\\").join("/");
    const key = rel.slice(0, rel.length - extname(rel).length);
    const hash = createHash("sha1").update(readFileSync(f)).digest("hex");
    keyToHash.set(key, hash);
    if (!hashToFile.has(hash)) hashToFile.set(hash, f);
  }
  const uniqueHashes = [...hashToFile.keys()];
  const sheetCount = Math.ceil(uniqueHashes.length / perSheet);

  await mkdir(out, { recursive: true });

  // build + encode one sheet at a time (cap peak memory at ~one 64MB RGBA buffer)
  const sheetFiles: string[] = [];
  let skipped = 0;
  for (let s = 0; s < sheetCount; s++) {
    const buf = Buffer.alloc(SHEET * SHEET * 4); // transparent RGBA
    const start = s * perSheet;
    const end = Math.min(start + perSheet, uniqueHashes.length);
    for (let i = start; i < end; i++) {
      const idx = i - start;
      const cx = (idx % cols) * cell;
      const cy = Math.floor(idx / cols) * cell;
      try {
        const raw = await sharp(hashToFile.get(uniqueHashes[i]))
          .resize(cell, cell, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .ensureAlpha()
          .raw()
          .toBuffer();
        for (let row = 0; row < cell; row++) {
          const srcStart = row * cell * 4;
          raw.copy(buf, ((cy + row) * SHEET + cx) * 4, srcStart, srcStart + cell * 4);
        }
      } catch {
        skipped++;
      }
    }
    const name = `atlas-${s}.png`;
    await sharp(buf, { raw: { width: SHEET, height: SHEET, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(join(out, name));
    sheetFiles.push(name);
    log(`[${ms()}] wrote ${name} (slots ${start}..${end - 1})`);
  }

  // manifest: every logical key -> its slot (dedup means many keys share a slot)
  const slotOf = new Map(uniqueHashes.map((h, i) => [h, i]));
  const icons: Record<string, IconSlot> = {};
  for (const [key, hash] of keyToHash) {
    const slot = slotOf.get(hash) ?? 0;
    const idx = slot % perSheet;
    icons[key] = {
      s: Math.floor(slot / perSheet),
      x: (idx % cols) * cell,
      y: Math.floor(idx / cols) * cell,
    };
  }
  const manifest: AtlasManifest = {
    cell,
    atlasSize: SHEET,
    sheets: sheetFiles,
    counts: { keys: keyToHash.size, unique: uniqueHashes.length, skipped },
    icons,
  };
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest));

  let totalOut = 0;
  for (const f of [...sheetFiles, "manifest.json"]) totalOut += (await stat(join(out, f))).size;
  log(
    `[${ms()}] atlas: ${keyToHash.size} keys -> ${uniqueHashes.length} unique -> ` +
      `${sheetFiles.length} sheet(s), ${(totalOut / 1048576).toFixed(1)} MB` +
      (skipped ? `, ${skipped} skipped` : ""),
  );

  return { ...manifest, ms: Date.now() - t0 };
}
