// Regenerate the typed database schema from the linked Supabase project.
//
//   npm run db:types
//
// Why this exists rather than a plain shell redirect: in PowerShell, `>` writes
// UTF-16LE. TypeScript copes, but a UTF-16 source file breaks grep, produces
// unreadable git diffs, and confuses tooling. This captures stdout and writes
// UTF-8 with LF endings, on every platform.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = "src/lib/supabase/database.types.ts";

const args = ["supabase", "gen", "types", "typescript", "--linked"];
console.log(`> npx ${args.join(" ")}`);

let out;
try {
  out = execFileSync("npx", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
} catch (err) {
  console.error("\nType generation failed. Is the project linked?");
  console.error("  npx supabase link --project-ref <your-ref>\n");
  console.error(err.stderr || err.message);
  process.exit(1);
}

// The CLI prints deprecation warnings to stdout on some versions; keep only the
// TypeScript, which always begins at the first `export`.
const start = out.indexOf("export type Json");
if (start === -1) {
  console.error("Unexpected output — no TypeScript found. Raw output:\n");
  console.error(out.slice(0, 500));
  process.exit(1);
}

const body = out.slice(start).replace(/\r\n/g, "\n").replace(/^﻿/, "");
writeFileSync(OUT, body, "utf8");

console.log(`Wrote ${OUT} (${body.length} chars, UTF-8).`);
console.log("Now run: npx tsc --noEmit");
