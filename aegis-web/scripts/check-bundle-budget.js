#!/usr/bin/env node
/**
 * Fails the build if the shared client JavaScript grows past a budget.
 *
 * Why: the regressions that made this app slow to become interactive were
 * never caught by anything, because a correctness test doesn't notice a
 * bundle getting bigger. Every route in the app pays for the shared entry
 * chunks, so that total is the single most load-bearing number for
 * time-to-interactive and it deserves a hard gate.
 *
 * What is measured: the gzipped total of `rootMainFiles` plus the polyfill
 * files from `.next/build-manifest.json` - i.e. the App Router shared client
 * entry that every route loads. Gzipped, because that is what the browser
 * actually downloads over the wire.
 *
 * Budget comes from FIRST_LOAD_BUDGET_KB (kilobytes). Set it from the current
 * measured value plus headroom so it catches growth rather than blocking
 * unrelated work, and lower it as code-splitting lands.
 *
 * Usage:
 *   node scripts/check-bundle-budget.js            # uses env budget or default
 *   FIRST_LOAD_BUDGET_KB=300 node scripts/check-bundle-budget.js
 *   node scripts/check-bundle-budget.js --report   # print size, never fail
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const NEXT_DIR = path.join(__dirname, "..", ".next");
const MANIFEST = path.join(NEXT_DIR, "build-manifest.json");
const DEFAULT_BUDGET_KB = 350;
const reportOnly = process.argv.includes("--report");

function fail(message) {
  console.error(`\n  check-bundle-budget: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST)) {
  fail(
    `no build manifest at ${path.relative(process.cwd(), MANIFEST)}.\n` +
      `  Run \`npm run build\` before this check.`,
  );
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
} catch (error) {
  fail(`could not parse build manifest: ${error.message}`);
}

const sharedFiles = [
  ...(manifest.rootMainFiles ?? []),
  ...(manifest.polyfillFiles ?? []),
];

if (sharedFiles.length === 0) {
  fail(
    "build manifest listed no rootMainFiles or polyfillFiles.\n" +
      "  The manifest format may have changed in this Next.js version - " +
      "update this script rather than deleting the gate.",
  );
}

const rows = [];
let totalGzip = 0;
let missing = 0;

for (const relative of sharedFiles) {
  const filePath = path.join(NEXT_DIR, relative);
  if (!fs.existsSync(filePath)) {
    missing += 1;
    continue;
  }
  const raw = fs.readFileSync(filePath);
  const gzip = zlib.gzipSync(raw, { level: 9 }).length;
  totalGzip += gzip;
  rows.push({ relative, raw: raw.length, gzip });
}

if (rows.length === 0) {
  fail(
    "none of the shared chunks listed in the manifest exist on disk.\n" +
      "  Was the build completed?",
  );
}

const kb = (bytes) => (bytes / 1024).toFixed(1);
rows.sort((a, b) => b.gzip - a.gzip);

console.log("\nShared client entry (loaded by every route), gzipped:\n");
for (const row of rows) {
  console.log(
    `  ${kb(row.gzip).padStart(8)} kB gz  ${kb(row.raw).padStart(8)} kB raw  ${row.relative}`,
  );
}
if (missing > 0) {
  console.log(`\n  note: ${missing} manifest entr${missing === 1 ? "y was" : "ies were"} not found on disk`);
}

const budgetKb = Number(process.env.FIRST_LOAD_BUDGET_KB) || DEFAULT_BUDGET_KB;
const totalKb = totalGzip / 1024;

console.log(
  `\n  total: ${kb(totalGzip)} kB gz   budget: ${budgetKb.toFixed(1)} kB gz\n`,
);

if (reportOnly) {
  process.exit(0);
}

if (totalKb > budgetKb) {
  fail(
    `shared client JS is ${kb(totalGzip)} kB gzipped, over the ` +
      `${budgetKb.toFixed(1)} kB budget by ${(totalKb - budgetKb).toFixed(1)} kB.\n` +
      `  Every route pays this cost. Either split the offending import out of\n` +
      `  the shared entry (dynamic import / next/dynamic), or raise\n` +
      `  FIRST_LOAD_BUDGET_KB in .github/workflows/ci.yml with a reason.`,
  );
}

console.log(`  within budget (${(budgetKb - totalKb).toFixed(1)} kB headroom)\n`);
