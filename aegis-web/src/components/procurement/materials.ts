/**
 * Turn a pasted / extracted materials list into purchase request lines.
 *
 * Handles the way site lists are usually written, e.g.
 *   *Deck slates (saligna) 3mx114x50/38–456 R/S
 *   *Wire nails 6inch–45kg
 *   12mm nuts and washers - 500each
 *   Cement 42.5, 120 bags
 * Headings, sign-offs and money lines (labour quotes, totals) are skipped and
 * reported, so nothing is silently dropped. Pure; unit tested with node:test.
 */

export interface ParsedLine {
  description: string;
  qty: number;
  uom: string;
  source: string;
}

export interface ParseResult {
  lines: ParsedLine[];
  skipped: { text: string; reason: string }[];
}

const UNIT_ALIASES: Record<string, string> = {
  each: "each", ea: "each", no: "each", nos: "each", pc: "each", pcs: "each", piece: "each", pieces: "each", units: "each", unit: "each", x: "each",
  kg: "kg", kgs: "kg",
  t: "tonne", ton: "tonne", tons: "tonne", tonne: "tonne", tonnes: "tonne",
  m: "m", metre: "m", metres: "m", meter: "m", meters: "m", lm: "m",
  m2: "m2", "m²": "m2", sqm: "m2",
  m3: "m3", "m³": "m3", cube: "m3", cubes: "m3",
  l: "litre", lt: "litre", litre: "litre", litres: "litre", liter: "litre", liters: "litre",
  bag: "bag", bags: "bag",
  sheet: "sheet", sheets: "sheet",
  roll: "roll", rolls: "roll",
  box: "box", boxes: "box",
  pkt: "packet", packet: "packet", packets: "packet",
  length: "length", lengths: "length",
  set: "set", sets: "set",
  pair: "pair", pairs: "pair",
};

// Separators people (and PDF extraction) put between an item and its quantity.
// U+FFFD shows up when a PDF's en dash can't be decoded.
const SEPARATOR = /\s*(?:[–—‒−�:=\t]|\s-\s|\s-(?=\d)|-{2,})\s*/;
const MONEY_WORDS = /(?:\$|\bUSD\b|\bZWG\b|\bZIG\b|\btotal\b|\blabou?r\b|\bcost\b)/i;
// Rand amounts: a standalone capital R before digits (not the "r 1" in "bar 1m").
const RAND = /(?:^|[\s(])R ?\d/;
const isMoney = (text: string) => MONEY_WORDS.test(text) || RAND.test(text);
const NOISE = /^(?:materials?|item|description|qty|quantity|thank you\.?|thanks\.?|regards\.?|signed.*|page \d+.*|\(?\d+\s+platforms?\)?)$/i;

function cleanDescription(text: string): string {
  // Bullets and list numbering ("1.", "2)"), but not sizes like "12mm".
  return text.replace(/^[\s*•·\-–—]*(?:\d+[.)]\s+)?/, "").replace(/\s+/g, " ").replace(/[\s,;:–—-]+$/, "").trim();
}

/** Split "456 R/S", "45kg", "500each", "120 bags" into quantity, unit and leftover text. */
function readQuantity(text: string): { qty: number; uom: string; rest: string } | null {
  const trimmed = text.trim();
  const m = trimmed.match(/^(\d{1,3}(?:[ ,]\d{3})+|\d+(?:\.\d+)?)\s*([A-Za-z²³]+\d?)?\.?\s*(.*)$/);
  if (!m) return null;
  const qty = Number(m[1].replace(/[ ,]/g, ""));
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const word = (m[2] ?? "").toLowerCase();
  const uom = UNIT_ALIASES[word];
  if (word && !uom) {
    // Not a unit ("R/S", "rough"): keep it as part of the description.
    return { qty, uom: "each", rest: trimmed.slice(m[1].length).trim() };
  }
  return { qty, uom: uom ?? "each", rest: (m[3] ?? "").trim() };
}

export function parseMaterialsList(text: string): ParseResult {
  const lines: ParsedLine[] = [];
  const skipped: ParseResult["skipped"] = [];
  // Some PDF extractors run a whole list together on one line; bullets still
  // mark where each row starts.
  const rows = text.split(/\r?\n/).flatMap((row) => row.split(/\s+(?=[*•]\s*[A-Za-z0-9])/));
  for (const raw of rows) {
    const source = raw.trim();
    if (!source) continue;
    const plain = source.replace(/^[*•·]\s*/, "").trim();
    if (NOISE.test(plain) || plain.length < 3) {
      skipped.push({ text: source, reason: "heading or note" });
      continue;
    }
    if (isMoney(plain)) {
      skipped.push({ text: source, reason: "price or labour line - not a material" });
      continue;
    }
    let parsed: ParsedLine | null = null;
    // 1) "item <separator> quantity [unit] [notes]" - use the LAST separator
    //    followed by a number, so sizes like 3mx114x50 stay in the description.
    const parts = plain.split(SEPARATOR);
    for (let i = parts.length - 1; i > 0 && !parsed; i--) {
      const q = readQuantity(parts[i]);
      const description = cleanDescription(parts.slice(0, i).join(" - "));
      if (q && description) {
        parsed = { description: q.rest ? `${description} ${q.rest}` : description, qty: q.qty, uom: q.uom, source };
      }
    }
    // 2) "item ... quantity unit" at the end of the line, e.g. "Cement 42.5, 120 bags".
    if (!parsed) {
      const m = plain.match(/^(.*?[A-Za-z].*?)[\s,;]+(\d{1,3}(?:[ ,]\d{3})+|\d+(?:\.\d+)?)\s*([A-Za-z²³]+\d?)?\.?$/);
      const word = (m?.[3] ?? "").toLowerCase();
      if (m && (!word || UNIT_ALIASES[word])) {
        const description = cleanDescription(m[1]);
        if (description) parsed = { description, qty: Number(m[2].replace(/[ ,]/g, "")), uom: UNIT_ALIASES[word] ?? "each", source };
      }
    }
    if (parsed && parsed.qty > 0) lines.push(parsed);
    else skipped.push({ text: source, reason: "no quantity found - add it manually if needed" });
  }
  return { lines, skipped };
}

/** Same normalisation the server uses to match list items with ordered lines. */
export function materialKey(description: string): string {
  return description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
