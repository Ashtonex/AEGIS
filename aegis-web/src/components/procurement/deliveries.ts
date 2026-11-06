/**
 * Deliveries the stores are waiting for: purchase orders already sent to the
 * supplier that still have goods outstanding. Shared by Inventory's Expected
 * Deliveries view and its "Which PO is this delivery for?" picker.
 *
 * Pure functions, no React/UI imports, so they can be unit tested with Node.
 */

export type Row = Record<string, any> & { id: string };

const s = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export const AWAITING_DELIVERY = new Set(["issued", "partially_received"]);

export function isAwaitingDelivery(po: Row): boolean {
  return AWAITING_DELIVERY.has(s(po.status));
}

/** A plain "YYYY-MM-DD" is that calendar day locally (see dueDay() in journey.ts). */
function calendarDay(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function expectedDate(po: Row): Date | null {
  return calendarDay(po.required_by_date ?? po.expected_delivery_date ?? po.expected_delivery);
}

export type DeliveryBucket = "overdue" | "today" | "week" | "later" | "undated";

export const DELIVERY_BUCKETS: { key: DeliveryBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "undated", label: "No delivery date" },
];

/** Calendar-day bucket, in local time, so "due today" means today on site. */
export function deliveryBucket(po: Row, now = new Date()): DeliveryBucket {
  const due = expectedDate(po);
  if (!due) return "undated";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const days = Math.round((dueDay - startOfToday) / 86_400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

export function poLines(po: Row): Row[] {
  return Array.isArray(po.lines) ? po.lines : Array.isArray(po.line_items) ? po.line_items : [];
}

/** Lines that still have goods to arrive, with how much is outstanding. */
export function outstandingLines(po: Row): Array<Row & { outstanding: number }> {
  return poLines(po)
    .map((line) => {
      const ordered = Number(line.quantity ?? line.qty ?? 0) || 0;
      const received = Number(line.quantity_received ?? 0) || 0;
      return { ...line, outstanding: Math.max(0, ordered - received) };
    })
    .filter((line) => line.outstanding > 0);
}

/**
 * Open orders sorted the way a storekeeper works through them: overdue first,
 * then soonest due, undated last.
 */
export function sortedOpenDeliveries(orders: Row[], now = new Date()): Row[] {
  const rank: Record<DeliveryBucket, number> = { overdue: 0, today: 1, week: 2, later: 3, undated: 4 };
  return orders
    .filter(isAwaitingDelivery)
    .map((po) => ({ po, bucket: deliveryBucket(po, now), t: expectedDate(po)?.getTime() ?? Infinity }))
    .sort((a, b) => rank[a.bucket] - rank[b.bucket] || a.t - b.t)
    .map((x) => x.po);
}

/** Free-text match on PO number, supplier, project and line descriptions. */
export function matchesDeliverySearch(po: Row, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [po.po_number, po.reference_number, po.supplier_name, po.project_name, ...poLines(po).map((l) => l.description ?? l.item_description)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
