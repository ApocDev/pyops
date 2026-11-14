#!/usr/bin/env node
// Keeps only the bundle target's better-sqlite3 binary in the server output.
// better-sqlite3 ships a prebuilt addon for every platform, and Nitro's file trace
// copies all of them into .output. linuxdeploy fails on the foreign Linux ones when
// it builds the AppImage, and the rest are dead weight in every installer.
//
// Runs after `vp build` in tauri.conf.json's beforeBuildCommand. Tauri sets
// TAURI_ENV_TARGET_TRIPLE to the bundle target, which differs from the host on the
// cross-compiled Intel Mac build.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = ".output/server/node_modules/better-sqlite3/prebuilds";
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "";
const arch = { x86_64: "x64", aarch64: "arm64" }[triple.split("-")[0]];
const os = [
  ["-windows-", "win32"],
  ["-apple-darwin", "darwin"],
  ["-linux-gnu", "linux"],
].find(([part]) => triple.includes(part))?.[1];

const keep = `${os}-${arch}.node`;
const files = readdirSync(dir);
if (!files.includes(keep)) {
  throw new Error(`no better-sqlite3 prebuild ${keep} for target "${triple}" in ${dir}`);
}
for (const file of files) if (file !== keep) rmSync(join(dir, file));
console.log(`kept better-sqlite3 prebuilds/${keep}`);
