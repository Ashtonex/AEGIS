/**
 * Multi-cell paste from Excel / Sheets (tab-separated, quoted cells allowed).
 * Pasted data never lands in the BOQ directly: it is parsed into rows,
 * mapped to columns (guessed from a header row when there is one), validated,
 * and shown in a preview where the estimator confirms the mapping.
 */
import { BoqLine, DEFAULT_SECTION, ItemType, newLineId } from "./domain";

export type PasteField = "ignore" | "section" | "item_no" | "description" | "qty" | "unit" | "rate" | "amount";

export const PASTE_FIELDS: Array<{ id: PasteField; label: string }> = [
  { id: "ignore", label: "Ignore" },
  { id: "section", label: "Section" },
  { id: "item_no", label: "Item code" },
  { id: "description", label: "Description" },
  { id: "qty", label: "Quantity" },
  { id: "unit", label: "Unit" },
  { id: "rate", label: "Rate" },
  { id: "amount", label: "Amount (lump sum)" },
];

/** RFC4180-ish TSV: tabs between cells, newlines between rows, a cell that
 *  starts with a quote may contain tabs/newlines and doubled quotes. */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_HINTS: Array<[RegExp, PasteField]> = [
  [/^(item|ref|no\.?|code|item\s*no)$/i, "item_no"],
  [/desc/i, "description"],
  [/^(qty|quantity|quant)/i, "qty"],
  [/^(unit|uom|units)$/i, "unit"],
  [/^(rate|unit\s*rate|price|unit\s*price)/i, "rate"],
  [/^(amount|total|sum|value)/i, "amount"],
  [/^(section|bill|element)/i, "section"],
];

export function looksLikeHeader(row: string[]): boolean {
  return row.some((c) => HEADER_HINTS.some(([re]) => re.test(c.trim()))) && !row.some((c) => /^-?[\d,]+(\.\d+)?$/.test(c.trim()) && c.trim() !== "");
}

/** Column mapping guess: from a header row when present, else the common
 *  BOQ shapes (description | qty | unit | rate, optionally with item code). */
export function guessMapping(rows: string[][]): { mapping: PasteField[]; hasHeader: boolean } {
  const width = Math.max(...rows.map((r) => r.length), 0);
  if (rows.length && looksLikeHeader(rows[0])) {
    const mapping = Array.from({ length: width }, (_, i) => {
      const label = (rows[0][i] || "").trim();
      return HEADER_HINTS.find(([re]) => re.test(label))?.[1] ?? "ignore";
    });
    return { mapping, hasHeader: true };
  }
  const isNum = (s: string | undefined) => !!s && /^-?[\d,]+(\.\d+)?$/.test(s.trim());
  const sample = rows.slice(0, 5);
  const firstNumeric = sample.every((r) => !isNum(r[0]));
  let mapping: PasteField[];
  if (width >= 5 && firstNumeric) mapping = ["item_no", "description", "qty", "unit", "rate"];
  else if (width === 4) mapping = ["description", "qty", "unit", "rate"];
  else if (width === 3) mapping = ["description", "qty", "unit"];
  else if (width === 2) mapping = ["description", "qty"];
  else mapping = ["description"];
  while (mapping.length < width) mapping.push("ignore");
  return { mapping: mapping.slice(0, width), hasHeader: false };
}

export interface PastedRow {
  sourceRow: number;
  line: BoqLine | null;
  errors: string[];
  warnings: string[];
}

const parseNumber = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[,\s$]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

export function mapRows(rows: string[][], mapping: PasteField[], hasHeader: boolean, defaultSection: string): PastedRow[] {
  const body = hasHeader ? rows.slice(1) : rows;
  const col = (field: PasteField) => mapping.indexOf(field);
  return body.map((cells, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sourceRow = index + (hasHeader ? 2 : 1);
    if (cells.length > mapping.length) {
      errors.push(`Row has ${cells.length} cells but ${mapping.length} columns are mapped - check for merged or shifted cells.`);
    }
    const get = (field: PasteField) => (col(field) >= 0 ? (cells[col(field)] ?? "").trim() : undefined);
    const description = get("description") ?? "";
    const qty = parseNumber(get("qty"));
    const rate = parseNumber(get("rate"));
    const amount = parseNumber(get("amount"));
    if (!description) errors.push("No description.");
    if (Number.isNaN(qty)) errors.push(`Quantity "${get("qty")}" is not a number.`);
    if (Number.isNaN(rate)) errors.push(`Rate "${get("rate")}" is not a number.`);
    if (Number.isNaN(amount)) errors.push(`Amount "${get("amount")}" is not a number.`);
    if ((qty ?? 0) < 0 || (rate ?? 0) < 0) errors.push("Negative quantity or rate - credits must be entered as a discount.");
    let itemType: ItemType = "measured";
    let lineQty = qty ?? 0;
    let lineRate = rate ?? 0;
    let unit = get("unit") ?? "";
    if ((qty === null || qty === 0) && (rate === null || rate === 0) && amount && !Number.isNaN(amount)) {
      itemType = "lump_sum";
      lineQty = 1;
      lineRate = amount;
      unit = unit || "sum";
    } else if (qty === null && rate === null && amount === null && description) {
      itemType = "note";
    }
    if (itemType === "measured" && !unit) warnings.push("No unit.");
    if (itemType === "measured" && qty !== null && rate !== null && amount !== null && !Number.isNaN(amount) && Math.abs(qty * rate - amount) > 0.01) {
      warnings.push(`Qty x rate (${(qty * rate).toFixed(2)}) differs from the pasted amount (${amount.toFixed(2)}).`);
    }
    if (description.length > 2000) errors.push("Description longer than 2,000 characters.");
    const line: BoqLine | null = errors.length ? null : {
      line_id: newLineId(),
      section: get("section") || defaultSection || DEFAULT_SECTION,
      item_no: get("item_no") ?? "",
      description,
      item_type: itemType,
      qty: lineQty,
      unit,
      rate: lineRate,
      buildup: [],
      rate_source: rate ? { type: "pasted", date: new Date().toISOString().slice(0, 10) } : null,
    };
    return { sourceRow, line, errors, warnings };
  });
}
