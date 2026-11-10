/**
 * Ordering one purchase request from several suppliers: each request line (or
 * part of a line) is given to a supplier at a price, and the API raises one
 * purchase order per supplier (POST /procurement/requisitions/{id}/purchase-orders).
 *
 * Pure functions, no React, so they run under plain `node --test`.
 */

export type Row = Record<string, any> & { id: string };

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
// Quantities are NUMERIC(14,3): compare to a thousandth.
const EPS = 0.0005;

export function sameItem(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) !== "" && norm(a) === norm(b);
}

export interface RequestLine {
  id: string;
  description: string;
  uom: string;
  quantity: number;
  ordered: number;
  remaining: number;
  estimatedUnitCost: number;
}

/** The request's lines with how much of each is still to order. */
export function requestLines(pr: Row): RequestLine[] {
  const lines: Row[] = Array.isArray(pr.lines) ? pr.lines : [];
  return lines
    .filter((l) => l && l.id && !l.is_deleted)
    .map((l) => {
      const quantity = n(l.quantity ?? l.qty);
      const ordered = n(l.quantity_ordered);
      return {
        id: String(l.id),
        description: String(l.description ?? ""),
        uom: String(l.unit_of_measure ?? l.uom ?? "each"),
        quantity,
        ordered,
        remaining: Math.max(quantity - ordered, 0),
        estimatedUnitCost: n(l.estimated_unit_cost ?? l.unit_cost),
      };
    });
}

export interface QuoteOption {
  responseId: string;
  supplierId: string;
  supplierName: string;
  reference: string;
  unitPrice: number;
}

/**
 * Supplier quotes for one request line: quotation lines whose description
 * matches the request line, on quotes that were not rejected. Cheapest first.
 */
export function quoteOptions(line: Pick<RequestLine, "description">, rfqs: Row[]): QuoteOption[] {
  const options: QuoteOption[] = [];
  for (const rfq of rfqs) {
    if (s(rfq.status) === "cancelled") continue;
    for (const response of Array.isArray(rfq.responses) ? rfq.responses : []) {
      if (s(response.status) === "rejected") continue;
      const items: Row[] = Array.isArray(response.line_items) ? response.line_items : [];
      const match = items.find((item) => sameItem(item?.description, line.description));
      const price = n(match?.unit_price ?? match?.unit_cost);
      if (!match || price <= 0) continue;
      options.push({
        responseId: String(response.id),
        supplierId: String(response.supplier_id),
        supplierName: String(response.supplier_name ?? "Supplier"),
        reference: String(response.reference ?? ""),
        unitPrice: price,
      });
    }
  }
  return options.sort((a, b) => a.unitPrice - b.unitPrice);
}

export interface Allocation {
  key: string;
  lineId: string;
  quantity: string;
  unitPrice: string;
  supplierId: string;
  /** Set when the price came from this supplier's quotation. */
  responseId: string | null;
}

let seq = 0;
export const newKey = () => `a${++seq}`;

/** One row per line still to order: the whole remaining quantity, estimated price, no supplier yet. */
export function initialAllocations(lines: RequestLine[]): Allocation[] {
  return lines
    .filter((l) => l.remaining > EPS)
    .map((l) => ({ key: newKey(), lineId: l.id, quantity: String(l.remaining), unitPrice: String(l.estimatedUnitCost), supplierId: "", responseId: null }));
}

/** Give a row to a supplier; a quoted supplier brings their quoted price with them. */
export function assignSupplier(row: Allocation, supplierId: string, quotes: QuoteOption[]): Allocation {
  const quote = quotes.find((q) => q.supplierId === supplierId);
  if (quote) return { ...row, supplierId, unitPrice: String(quote.unitPrice), responseId: quote.responseId };
  return { ...row, supplierId, responseId: null };
}

/** Rows that will be ordered: a supplier and a quantity above zero. */
export const assigned = (rows: Allocation[]) => rows.filter((r) => r.supplierId && n(r.quantity) > 0);

export interface SupplierGroup {
  supplierId: string;
  rows: Allocation[];
  subtotal: number;
  quoted: boolean;
}

/** One group per supplier, in the order suppliers first appear - one purchase order each. */
export function groupBySupplier(rows: Allocation[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const row of assigned(rows)) {
    const group = groups.get(row.supplierId) ?? { supplierId: row.supplierId, rows: [], subtotal: 0, quoted: true };
    group.rows.push(row);
    group.subtotal += Math.round(n(row.quantity) * n(row.unitPrice) * 100) / 100;
    group.quoted = group.quoted && Boolean(row.responseId);
    groups.set(row.supplierId, group);
  }
  return [...groups.values()];
}

/** A reason for the supplier choice is needed unless every ordered line is priced from a quote. */
export function needsReason(rows: Allocation[]): boolean {
  return assigned(rows).some((r) => !r.responseId);
}

/** What is wrong with the allocation, or null when it can be sent. */
export function allocationProblem(rows: Allocation[], lines: RequestLine[]): string | null {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const live = assigned(rows);
  if (!live.length) return "Choose a supplier for at least one line.";
  const totals = new Map<string, number>();
  const pairs = new Set<string>();
  for (const row of live) {
    const line = byId.get(row.lineId);
    if (!line) return "A line is no longer on this request. Reload and try again.";
    if (n(row.unitPrice) < 0 || row.unitPrice.trim() === "") return `Give a unit price for '${line.description}'.`;
    const pair = `${row.lineId}|${row.supplierId}`;
    if (pairs.has(pair)) return `'${line.description}' is given to the same supplier twice - combine the quantities.`;
    pairs.add(pair);
    totals.set(row.lineId, (totals.get(row.lineId) ?? 0) + n(row.quantity));
  }
  for (const [lineId, total] of totals) {
    const line = byId.get(lineId)!;
    if (total > line.remaining + EPS) return `'${line.description}': ${total} given to suppliers but only ${line.remaining} ${line.uom} is still to order.`;
  }
  return null;
}

/** Split a row: a second row for the same line, with whatever quantity the first doesn't take. */
export function splitRow(rows: Allocation[], key: string, lines: RequestLine[]): Allocation[] {
  const index = rows.findIndex((r) => r.key === key);
  if (index < 0) return rows;
  const row = rows[index];
  const line = lines.find((l) => l.id === row.lineId);
  const taken = rows.filter((r) => r.lineId === row.lineId).reduce((sum, r) => sum + n(r.quantity), 0);
  const left = Math.max((line?.remaining ?? 0) - taken, 0);
  const fresh: Allocation = { key: newKey(), lineId: row.lineId, quantity: String(Math.round(left * 1000) / 1000), unitPrice: row.unitPrice, supplierId: "", responseId: null };
  return [...rows.slice(0, index + 1), fresh, ...rows.slice(index + 1)];
}

export function toPayload(rows: Allocation[], reason: string) {
  return {
    lines: assigned(rows).map((r) => ({
      requisition_line_id: r.lineId,
      supplier_id: r.supplierId,
      // The API takes 3 decimals of quantity and 4 of unit price.
      quantity: Math.round(n(r.quantity) * 1000) / 1000,
      unit_price: Math.round(n(r.unitPrice) * 10000) / 10000,
      rfq_response_id: r.responseId,
    })),
    selection_reason: reason.trim() || null,
  };
}
