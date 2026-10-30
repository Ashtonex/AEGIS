/**
 * Estimating workspace domain: the BOQ line shape stored in
 * finance.quotations.metadata.items, and a PREVIEW of the server's
 * QuotationCalculator (imperium-api/app/services/quotations/calculator.py).
 *
 * The preview exists so totals move while you type. Every save is re-priced
 * on the server, and the saved/issued/awarded figures are always the
 * server's - the header shows the server total next to this preview.
 */

export type ItemType = "measured" | "lump_sum" | "provisional" | "note";

export type ResourceType = "material" | "labour" | "equipment" | "subcontractor" | "transport" | "waste_allowance";

export interface BuildupLine {
  type: ResourceType;
  name: string;
  qty: number;
  unit: string;
  rate: number;
  currency?: string;
  /** Free-text source label (supplier, PO number, library). */
  source?: string;
  source_date?: string;
  /** Set when picked from a live source (inventory, PO, rate card, fleet,
   *  site labour) so Rates can look the same source up again. */
  source_type?: string;
  source_ref?: string;
  spec?: string;
  conversion_note?: string;
}

export interface BoqLine {
  line_id: string;
  section: string;
  item_no: string;
  description: string;
  item_type: ItemType;
  qty: number;
  unit: string;
  rate: number;
  buildup: BuildupLine[];
  rate_source?: { type: string; ref?: string; date?: string; note?: string } | null;
  /** The template the build-up was copied from (a copy: later template
   *  versions never change this line). */
  buildup_template?: { id: string | null; code: string; version: number | null; applied_at: string } | null;
  zero_rate_reason?: string;
  takeoff?: { drawing_revision_id?: string; drawing_name?: string; revision_label?: string; verified?: boolean } | null;
  review_status?: "unreviewed" | "reviewed" | "query";
  // Unknown keys from older records are carried through untouched.
  [key: string]: unknown;
}

export interface CommercialInputs {
  preliminaries: number;
  overhead_pct: number;
  contingency_pct: number;
  profit_pct: number;
  discount: number;
  provisional_sums: number;
  apply_vat: boolean;
  vat_rate: number;
}

export const DEFAULT_SECTION = "Measured Works";

export const RESOURCE_TYPES: Array<{ id: ResourceType; label: string }> = [
  { id: "material", label: "Materials" },
  { id: "labour", label: "Labour" },
  { id: "equipment", label: "Plant & equipment" },
  { id: "subcontractor", label: "Subcontract" },
  { id: "transport", label: "Transport" },
  { id: "waste_allowance", label: "Wastage" },
];

export function newLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Normalises a stored item. Keeps every unknown key so a save never drops
 *  data written by another screen (e.g. importer source_sheet/source_row). */
export function normaliseLine(raw: Record<string, any>): BoqLine {
  const qtyRaw = raw.qty ?? raw.quantity;
  const lumpFromAmount = !num(qtyRaw) && !num(raw.rate) && num(raw.amount);
  return {
    ...raw,
    line_id: String(raw.line_id || newLineId()),
    section: String(raw.section || DEFAULT_SECTION),
    item_no: String(raw.item_no ?? raw.itemNo ?? ""),
    description: String(raw.description ?? ""),
    item_type: (["measured", "lump_sum", "provisional", "note"].includes(raw.item_type) ? raw.item_type : "measured") as ItemType,
    qty: lumpFromAmount ? 1 : num(qtyRaw),
    unit: String(raw.unit ?? (lumpFromAmount ? "sum" : "")),
    rate: lumpFromAmount ? num(raw.amount) : num(raw.rate),
    buildup: Array.isArray(raw.buildup) ? raw.buildup.map((b: any) => ({ ...b, qty: num(b.qty), rate: num(b.rate) })) : [],
  };
}

/** What gets saved: qty is also written as quantity for consumers that read
 *  either key (importer, procurement plan, budget seeding). */
export function serialiseLine(line: BoqLine): Record<string, unknown> {
  return { ...line, quantity: line.qty };
}

/** Half-up rounding to cents on the decimal string, like Decimal.quantize. */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

export function lineAmount(line: BoqLine): number {
  if (line.item_type === "note") return 0;
  return roundCents(Math.max(0, line.qty) * Math.max(0, line.rate));
}

export function buildupTotal(line: Pick<BoqLine, "buildup">): number {
  return (line.buildup || []).reduce((acc, b) => acc + num(b.qty) * num(b.rate), 0);
}

export interface PreviewTotals {
  direct: number;
  prelims: number;
  overhead: number;
  contingency: number;
  profit: number;
  provisional: number;
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  grand: number;
  cost: number;
  profitRealised: number;
  markupPct: number | null;
  marginPct: number | null;
  sections: Array<{ section: string; amount: number; count: number }>;
}

/** Mirrors QuotationCalculator.calculate: overhead, contingency and profit
 *  are each a % of (direct + preliminaries), not compounded; provisional
 *  sums after markups; discount before tax. */
export function previewTotals(lines: BoqLine[], c: CommercialInputs): PreviewTotals {
  const sectionIndex = new Map<string, number>();
  const sections: PreviewTotals["sections"] = [];
  let direct = 0;
  for (const line of lines) {
    const amount = lineAmount(line);
    direct += amount;
    const key = line.section || DEFAULT_SECTION;
    if (!sectionIndex.has(key)) {
      sectionIndex.set(key, sections.length);
      sections.push({ section: key, amount: 0, count: 0 });
    }
    const s = sections[sectionIndex.get(key)!];
    s.amount += amount;
    s.count += 1;
  }
  direct = roundCents(direct);
  const prelims = roundCents(Math.max(0, c.preliminaries));
  const base = direct + prelims;
  const overhead = roundCents(base * Math.max(0, c.overhead_pct) / 100);
  const contingency = roundCents(base * Math.max(0, c.contingency_pct) / 100);
  const profit = roundCents(base * Math.max(0, c.profit_pct) / 100);
  const provisional = roundCents(Math.max(0, c.provisional_sums));
  const subtotal = roundCents(base + overhead + contingency + profit + provisional);
  const discount = roundCents(Math.max(0, c.discount));
  const taxable = Math.max(0, roundCents(subtotal - discount));
  const tax = c.apply_vat ? roundCents(taxable * c.vat_rate) : 0;
  const grand = roundCents(taxable + tax);
  const cost = roundCents(base + overhead + contingency + provisional);
  const profitRealised = roundCents(taxable - cost);
  return {
    direct, prelims, overhead, contingency, profit, provisional, subtotal, discount, taxable, tax, grand, cost, profitRealised,
    markupPct: cost > 0 ? (profitRealised / cost) * 100 : null,
    marginPct: taxable > 0 ? (profitRealised / taxable) * 100 : null,
    sections,
  };
}

// Units that measure the same thing and can be converted without a
// specification-dependent factor. Anything else is incompatible and must be
// converted explicitly by the estimator (conversion_note), never silently.
const UNIT_ALIASES: Record<string, string> = {
  m2: "m2", "m²": "m2", sqm: "m2", m3: "m3", "m³": "m3", cum: "m3", cube: "m3", m: "m", lm: "m",
  kg: "kg", t: "t", ton: "t", tonne: "t", no: "no", "no.": "no", nr: "no", nos: "no", each: "no", ea: "no", pcs: "no",
  hr: "hr", hrs: "hr", hour: "hr", hours: "hr", day: "day", days: "day", l: "l", litre: "l", litres: "l",
  sum: "sum", item: "item", bag: "bag", bags: "bag",
};

export function canonicalUnit(unit: string): string {
  const key = unit.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? key;
}

/** Wastage double-count: a waste_allowance resource AND a material line
 *  whose name says it already includes wastage. */
export function wastageWarning(line: BoqLine): string | null {
  const hasWasteLine = line.buildup.some((b) => b.type === "waste_allowance");
  const inlineWaste = line.buildup.some((b) => b.type === "material" && /(incl\.?|including)\s*(waste|wastage)/i.test(b.name));
  return hasWasteLine && inlineWaste ? "Wastage appears both as its own line and inside a material description - check it is not counted twice." : null;
}

export function formatMoney(value: number | string | null | undefined, currency = "USD"): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (!Number.isFinite(n)) return "—";
  const formatted = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${n < 0 ? "-" : ""}${symbol}${formatted}`;
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
