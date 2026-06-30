#!/usr/bin/env node
// `drizzle-kit generate`, but with a REQUIRED migration name so migrations get
// meaningful filenames (e.g. `0001_add_block_health.sql`) instead of drizzle's
// random auto-names. Usage: vp run db:generate <name>
import { execFileSync } from "node:child_process";

// tolerate a stray `--` separator; take the first real (non-flag) argument
const name = process.argv.slice(2).find((a) => a !== "--" && !a.startsWith("-"));
if (!name) {
  console.error(
    [
      "migration name required — usage: vp run db:generate <name>",
      "",
      "Use a short, descriptive snake_case name for the schema change it makes,",
      "like a commit summary — what the migration does, not when you wrote it:",
      "  ✓ add_block_health        ✓ rename_turd_columns      ✓ drop_legacy_todos",
      "  ✗ update                  ✗ fix                      ✗ migration2",
    ].join("\n"),
  );
  process.exit(1);
}
execFileSync("drizzle-kit", ["generate", "--name", name], { stdio: "inherit" });
