/**
 * Procurement "journeys": one purchase = a purchase request plus the quote
 * requests, purchase orders and supplier invoices that came from it.
 *
 * Pure functions over the rows the procurement workspace already loads, so the
 * My Tasks and Purchases views need no new endpoints. Kept free of React/UI
 * imports so it can be unit tested with plain Node.
 */

export type Row = Record<string, any> & { id: string };

const s = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export const STAGES = [
  { key: "request", label: "Request" },
  { key: "approval", label: "Approval" },
  { key: "order", label: "Order" },
  { key: "delivery", label: "Delivery" },
  { key: "invoice", label: "Invoice" },
  { key: "payment", label: "Payment" },
  { key: "done", label: "Done" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"] | "stopped";

export interface Purchase {
  id: string;
  number: string;
  project: string;
  title: string;
  amount: number;
  request: Row | null;
  rfqs: Row[];
  orders: Row[];
  invoices: Row[];
  stage: StageKey;
  /** Index into STAGES; -1 when stopped (rejected/cancelled). */
  stageIndex: number;
  waitingOn: string;
  overdue: boolean;
  updatedAt: number;
}

const PAID_INVOICE = new Set(["approved", "paid", "payment_approved", "approved_for_payment"]);
const LIVE_PO = (po: Row) => s(po.status) !== "cancelled";

export function invoiceIsPaidOrApproved(inv: Row): boolean {
  return PAID_INVOICE.has(s(inv.status)) || ["approved", "paid"].includes(s(inv.payment_status));
}

export function invoiceIsMatched(inv: Row): boolean {
  return s(inv.match_status ?? inv.matching_status) === "matched";
}

export function poIsOverdue(po: Row, now = Date.now()): boolean {
  if (!["issued", "partially_received"].includes(s(po.status))) return false;
  const raw = po.required_by_date ?? po.expected_delivery_date;
  if (!raw) return false;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) && t < now;
}

function time(...values: unknown[]): number {
  return Math.max(0, ...values.map((v) => (v ? new Date(String(v)).getTime() : 0)).filter(Number.isFinite));
}

/** Where a purchase is, and who it is waiting on. */
export function purchaseStage(p: Pick<Purchase, "request" | "rfqs" | "orders" | "invoices">): { stage: StageKey; waitingOn: string } {
  const req = p.request ? s(p.request.status) : "";
  const orders = p.orders.filter(LIVE_PO);
  if (req === "rejected") return { stage: "stopped", waitingOn: "Rejected" };
  if (!orders.length && p.orders.length && p.orders.every((o) => s(o.status) === "cancelled")) {
    return { stage: "stopped", waitingOn: "Order cancelled" };
  }
  if (!orders.length) {
    if (!p.request || req === "draft") return { stage: "request", waitingOn: "Submit the request" };
    if (req === "submitted") return { stage: "approval", waitingOn: "Approval" };
    const openRfq = p.rfqs.find((r) => ["draft", "issued"].includes(s(r.status)));
    return { stage: "order", waitingOn: openRfq ? "Supplier quotes" : "Create the purchase order" };
  }
  const statuses = orders.map((o) => s(o.status));
  if (statuses.some((st) => st === "draft")) return { stage: "order", waitingOn: "Approve the PO" };
  if (statuses.some((st) => st === "approved")) return { stage: "order", waitingOn: "Send the PO to the supplier" };
  if (statuses.some((st) => ["issued", "partially_received"].includes(st))) return { stage: "delivery", waitingOn: "Delivery" };
  // Everything ordered has arrived.
  const invoices = p.invoices.filter((i) => s(i.status) !== "rejected" && s(i.status) !== "cancelled");
  if (!invoices.length) return { stage: "invoice", waitingOn: "Supplier invoice" };
  if (invoices.some((i) => !invoiceIsMatched(i))) return { stage: "invoice", waitingOn: "Check the invoice" };
  if (invoices.some((i) => !invoiceIsPaidOrApproved(i))) return { stage: "payment", waitingOn: "Approve payment" };
  return { stage: "done", waitingOn: "Nothing - complete" };
}

export function buildPurchases(requisitions: Row[], rfqs: Row[], orders: Row[], invoices: Row[], now = Date.now()): Purchase[] {
  const invoicesByPo = new Map<string, Row[]>();
  for (const inv of invoices) {
    if (!inv.po_id) continue;
    const key = String(inv.po_id);
    invoicesByPo.set(key, [...(invoicesByPo.get(key) ?? []), inv]);
  }
  const make = (request: Row | null, myRfqs: Row[], myOrders: Row[]): Purchase => {
    const myInvoices = myOrders.flatMap((o) => invoicesByPo.get(String(o.id)) ?? []);
    const { stage, waitingOn } = purchaseStage({ request, rfqs: myRfqs, orders: myOrders, invoices: myInvoices });
    const liveOrders = myOrders.filter(LIVE_PO);
    const orderTotal = liveOrders.reduce((sum, o) => sum + n(o.total_amount ?? o.amount), 0);
    const first = request ?? myOrders[0];
    return {
      id: request ? `req-${request.id}` : `po-${myOrders[0].id}`,
      number: String(request?.requisition_number ?? request?.pr_number ?? myOrders[0]?.po_number ?? first.id.slice(0, 8).toUpperCase()),
      project: String(first.project_name ?? myOrders[0]?.project_name ?? "—"),
      title: String(request?.justification ?? myOrders[0]?.title ?? myRfqs[0]?.title ?? ""),
      amount: orderTotal || n(request?.total_estimated ?? request?.estimated_total),
      request,
      rfqs: myRfqs,
      orders: myOrders,
      invoices: myInvoices,
      stage,
      stageIndex: stage === "stopped" ? -1 : STAGES.findIndex((st) => st.key === stage),
      waitingOn,
      overdue: liveOrders.some((o) => poIsOverdue(o, now)),
      updatedAt: time(request?.updated_at, request?.created_at, ...myOrders.map((o) => o.updated_at), ...myInvoices.map((i) => i.updated_at)),
    };
  };

  const byRequest = new Map<string, { rfqs: Row[]; orders: Row[] }>();
  for (const req of requisitions) byRequest.set(String(req.id), { rfqs: [], orders: [] });
  const orphanOrders: Row[] = [];
  for (const rfq of rfqs) byRequest.get(String(rfq.requisition_id))?.rfqs.push(rfq);
  for (const po of orders) {
    const bucket = po.requisition_id ? byRequest.get(String(po.requisition_id)) : undefined;
    if (bucket) bucket.orders.push(po);
    else orphanOrders.push(po);
  }
  const purchases = requisitions.map((req) => {
    const b = byRequest.get(String(req.id))!;
    return make(req, b.rfqs, b.orders);
  });
  for (const po of orphanOrders) purchases.push(make(null, [], [po]));
  // Stuck work first: overdue, then by how recently it moved.
  return purchases.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.updatedAt - a.updatedAt);
}

// ─── My Tasks ────────────────────────────────────────────────────────────────

export type TaskAction =
  | { type: "submitRequest"; row: Row }
  | { type: "approveRequest"; row: Row }
  | { type: "createPO"; row: Row }
  | { type: "openPurchase"; purchaseId: string }
  | { type: "openPO"; row: Row }
  | { type: "receivePO"; row: Row }
  | { type: "invoicePO"; row: Row }
  | { type: "checkInvoice"; row: Row }
  | { type: "approvePayment"; row: Row };

export type TaskGroup = "approvals" | "ordering" | "deliveries" | "invoices";

export interface Task {
  id: string;
  group: TaskGroup;
  verb: string;
  title: string;
  meta: string;
  amount: number;
  urgent: boolean;
  action: TaskAction;
}

export const TASK_GROUPS: { key: TaskGroup; label: string; empty: string }[] = [
  { key: "approvals", label: "Approvals", empty: "No requests or orders waiting for your approval." },
  { key: "ordering", label: "Ordering", empty: "Nothing to order or send to suppliers." },
  { key: "deliveries", label: "Deliveries", empty: "No deliveries to record." },
  { key: "invoices", label: "Invoices & payment", empty: "No supplier invoices to check or pay." },
];

/**
 * The work waiting on the current user: only actions they hold the permission
 * for (the same keys the API enforces), and their own drafts to submit.
 */
export function buildTasks(
  purchases: Purchase[],
  can: (permission: string) => boolean,
  userId: string | null,
  now = Date.now(),
): Task[] {
  const tasks: Task[] = [];
  const label = (p: Purchase) => [p.project, p.title].filter((x) => x && x !== "—").join(" · ");
  for (const p of purchases) {
    const req = p.request;
    const reqStatus = req ? s(req.status) : "";
    if (req && ["draft", "rejected"].includes(reqStatus) && can("procurement.requisition.submit") && (!userId || [req.created_by, req.requested_by].map(String).includes(userId))) {
      tasks.push({ id: `submit-${req.id}`, group: "approvals", verb: reqStatus === "rejected" ? "Fix and resubmit" : "Submit for approval", title: p.number, meta: label(p), amount: p.amount, urgent: false, action: { type: "submitRequest", row: req } });
    }
    if (req && reqStatus === "submitted" && can("procurement.requisition.approve")) {
      tasks.push({ id: `approve-${req.id}`, group: "approvals", verb: "Approve or reject request", title: p.number, meta: label(p), amount: p.amount, urgent: s(req.priority) === "emergency" || s(req.priority) === "urgent", action: { type: "approveRequest", row: req } });
    }
    const liveOrders = p.orders.filter(LIVE_PO);
    if (req && reqStatus === "approved" && !liveOrders.length) {
      const openRfq = p.rfqs.find((r) => ["draft", "issued"].includes(s(r.status)));
      if (openRfq && can("procurement.rfq.manage")) {
        tasks.push({ id: `quotes-${openRfq.id}`, group: "ordering", verb: "Record or pick supplier quotes", title: p.number, meta: label(p), amount: p.amount, urgent: false, action: { type: "openPurchase", purchaseId: p.id } });
      } else if (!openRfq && can("procurement.po.create")) {
        tasks.push({ id: `po-${req.id}`, group: "ordering", verb: "Create the purchase order", title: p.number, meta: label(p), amount: p.amount, urgent: false, action: { type: "createPO", row: req } });
      }
    }
    for (const po of liveOrders) {
      const st = s(po.status);
      const poLabel = `${po.po_number ?? p.number} · ${po.supplier_name ?? "supplier"}`;
      const amount = n(po.total_amount ?? po.amount);
      if (st === "draft" && can("procurement.po.approve")) {
        tasks.push({ id: `po-approve-${po.id}`, group: "approvals", verb: "Approve purchase order", title: poLabel, meta: label(p), amount, urgent: false, action: { type: "openPO", row: po } });
      }
      if (st === "approved" && can("procurement.po.issue")) {
        tasks.push({ id: `po-issue-${po.id}`, group: "ordering", verb: "Send PO to supplier", title: poLabel, meta: label(p), amount, urgent: false, action: { type: "openPO", row: po } });
      }
      if (["issued", "partially_received"].includes(st) && can("procurement.grn.create")) {
        const late = poIsOverdue(po, now);
        tasks.push({ id: `grn-${po.id}`, group: "deliveries", verb: late ? "Delivery overdue - record or chase" : "Record delivery", title: poLabel, meta: label(p), amount, urgent: late, action: { type: "receivePO", row: po } });
      }
      const poInvoices = p.invoices.filter((i) => String(i.po_id) === String(po.id));
      if (st === "received" && !poInvoices.length && can("procurement.invoice.create")) {
        tasks.push({ id: `inv-${po.id}`, group: "invoices", verb: "Register supplier invoice", title: poLabel, meta: label(p), amount, urgent: false, action: { type: "invoicePO", row: po } });
      }
    }
    for (const inv of p.invoices) {
      const st = s(inv.status);
      if (st === "rejected" || st === "cancelled") continue;
      const invLabel = `${inv.invoice_number ?? inv.supplier_invoice_ref ?? "Invoice"} · ${inv.supplier_name ?? ""}`.replace(/ · $/, "");
      if (!invoiceIsMatched(inv) && inv.po_id && inv.grn_id && can("procurement.invoice.match")) {
        tasks.push({ id: `check-${inv.id}`, group: "invoices", verb: "Check invoice against order & delivery", title: invLabel, meta: label(p), amount: n(inv.total_amount), urgent: s(inv.match_status) === "disputed", action: { type: "checkInvoice", row: inv } });
      } else if (invoiceIsMatched(inv) && !invoiceIsPaidOrApproved(inv) && can("procurement.invoice.approve_payment")) {
        const due = inv.due_date ? new Date(String(inv.due_date)).getTime() < now : false;
        tasks.push({ id: `pay-${inv.id}`, group: "invoices", verb: due ? "Approve payment - past due date" : "Approve payment", title: invLabel, meta: label(p), amount: n(inv.total_amount), urgent: due, action: { type: "approvePayment", row: inv } });
      }
    }
  }
  return tasks.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
