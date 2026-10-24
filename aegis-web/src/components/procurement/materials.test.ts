// Run: node --experimental-strip-types --test src/components/procurement/materials.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMaterialsList } from "./materials.ts";

// The Troutbeck canopy tour list exactly as PDF text extraction returns it
// (the en dashes come out as U+FFFD).
const TROUTBECK = `Troutbeck canopy tour
(13 platforms)

Materials
*Deck slates (saligna) 3mx114x50/38�456 R/S
*Walkway slates 3mx114x50/38mm�245 R/S
*Braces &Beams 4.2mx152x50/38�299 R/S
*Walkway rails 3mx152x50/38�58 R/S
*Gum poles 8mx150 dia.�60
*Gum poles 6mx150 dia.�216
*Gum poles 8mx300 dia.�13
*Wire nails 6inch�45kg
*Wire nails 4 inch�80kg
*Wire nails 2 inch�10kg
*Wire nails 3inch�50kg
*Threaded bar 1m x12mm�120
*Hoop irons 1m�100
*12mm nuts and washers�500each
*Steel cutting disc 115mm�10
*Auger bit 13mmx350�3

Labour for timber structural work�$1300 for each landing(�12 =$ 15600)
�Walkways �$1200

Total labour cost $16800.
Thank you.`;

test("Troutbeck list: all 16 materials, quantities and units", () => {
  const { lines } = parseMaterialsList(TROUTBECK);
  assert.deepEqual(
    lines.map((l) => [l.description, l.qty, l.uom]),
    [
      ["Deck slates (saligna) 3mx114x50/38 R/S", 456, "each"],
      ["Walkway slates 3mx114x50/38mm R/S", 245, "each"],
      ["Braces &Beams 4.2mx152x50/38 R/S", 299, "each"],
      ["Walkway rails 3mx152x50/38 R/S", 58, "each"],
      ["Gum poles 8mx150 dia.", 60, "each"],
      ["Gum poles 6mx150 dia.", 216, "each"],
      ["Gum poles 8mx300 dia.", 13, "each"],
      ["Wire nails 6inch", 45, "kg"],
      ["Wire nails 4 inch", 80, "kg"],
      ["Wire nails 2 inch", 10, "kg"],
      ["Wire nails 3inch", 50, "kg"],
      ["Threaded bar 1m x12mm", 120, "each"],
      ["Hoop irons 1m", 100, "each"],
      ["12mm nuts and washers", 500, "each"],
      ["Steel cutting disc 115mm", 10, "each"],
      ["Auger bit 13mmx350", 3, "each"],
    ],
  );
});

test("labour and money lines are skipped and reported, never imported", () => {
  const { lines, skipped } = parseMaterialsList(TROUTBECK);
  assert.ok(lines.every((l) => !/labou?r|\$/i.test(l.description)));
  const reasons = skipped.map((s) => s.reason);
  assert.equal(reasons.filter((r) => r.startsWith("price or labour")).length, 3);
  assert.ok(skipped.some((s) => s.text.startsWith("Troutbeck canopy tour")));
});

test("other common formats", () => {
  const { lines } = parseMaterialsList(
    ["Cement 42.5 - 120 bags", "River sand: 12 m3", "Y12 rebar 6m — 1,200 lengths", "PVC pipe 110mm 24", "1. Binding wire 25kg"].join("\n"),
  );
  assert.deepEqual(
    lines.map((l) => [l.description, l.qty, l.uom]),
    [
      ["Cement 42.5", 120, "bag"],
      ["River sand", 12, "m3"],
      ["Y12 rebar 6m", 1200, "length"],
      ["PVC pipe 110mm", 24, "each"],
      ["Binding wire", 25, "kg"],
    ],
  );
});

test("a list run together on one line is split at its bullets", () => {
  const oneLine = TROUTBECK.replace(/\n+/g, "  ");
  const { lines, skipped } = parseMaterialsList(oneLine);
  assert.deepEqual([lines[0].description, lines[0].qty], ["Deck slates (saligna) 3mx114x50/38 R/S", 456]);
  // Best effort: the last bullet runs into the un-bulleted labour text, so it is
  // reported for the reviewer rather than silently dropped. (The server's
  // layout-mode extraction keeps real PDFs one row per line.)
  assert.equal(lines.length, 15);
  assert.ok(skipped.some((s) => s.text.includes("Auger bit 13mmx350")));
});

test("a line without a quantity is reported, not guessed", () => {
  const { lines, skipped } = parseMaterialsList("Shuttering ply as required");
  assert.equal(lines.length, 0);
  assert.match(skipped[0].reason, /no quantity/);
});
