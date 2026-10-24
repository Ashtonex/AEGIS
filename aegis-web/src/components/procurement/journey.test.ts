// Run: node --test src/components/procurement/journey.test.ts   (Node >= 22.6 strips the types)
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPurchases, buildTasks, purchaseStage, type Row } from "./journey.ts";

const NOW = new Date("2026-10-24T12:00:00Z").getTime();
const req = (id: string, status: string, extra: Partial<Row> = {}): Row => ({ id, status, requisition_number: `REQ-${id}`, project_name: "Trout Beck", created_by: "me", ...extra });
const po = (id: string, reqId: string | null, status: string, extra: Partial<Row> = {}): Row => ({ id, requisition_id: reqId, status, po_number: `PO-${id}`, supplier_name: "Halsteds", total_amount: 100, ...extra });
const inv = (id: string, poId: string, extra: Partial<Row> = {}): Row => ({ id, po_id: poId, grn_id: "g1", status: "received", match_status: "unmatched", total_amount: 100, ...extra });
const all = () => true;

test("stage follows the purchase from draft to done", () => {
  const cases: Array<[Parameters<typeof purchaseStage>[0], string, string]> = [
    [{ request: req("1", "draft"), rfqs: [], orders: [], invoices: [] }, "request", "Submit the request"],
    [{ request: req("1", "submitted"), rfqs: [], orders: [], invoices: [] }, "approval", "Approval"],
    [{ request: req("1", "approved"), rfqs: [], orders: [], invoices: [] }, "order", "Create the purchase order"],
    [{ request: req("1", "approved"), rfqs: [{ id: "r", status: "issued" }], orders: [], invoices: [] }, "order", "Supplier quotes"],
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "draft")], invoices: [] }, "order", "Approve the PO"],
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "approved")], invoices: [] }, "order", "Send the PO to the supplier"],
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "issued")], invoices: [] }, "delivery", "Delivery"],
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "received")], invoices: [] }, "invoice", "Supplier invoice"],
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "received")], invoices: [inv("i", "p")] }, "invoice", "Check the invoice"],
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "received")], invoices: [inv("i", "p", { match_status: "matched", status: "matched" })] }, "payment", "Approve payment"],
    // payment-decision sets status 'approved' - that counts as done
    [{ request: req("1", "ordered"), rfqs: [], orders: [po("p", "1", "received")], invoices: [inv("i", "p", { match_status: "matched", status: "approved" })] }, "done", "Nothing - complete"],
    [{ request: req("1", "rejected"), rfqs: [], orders: [], invoices: [] }, "stopped", "Rejected"],
  ];
  for (const [input, stage, waiting] of cases) {
    assert.deepEqual(purchaseStage(input), { stage, waitingOn: waiting });
  }
});

test("orders, quotes and invoices are grouped under their request; orphan POs stand alone", () => {
  const purchases = buildPurchases(
    [req("1", "ordered")],
    [{ id: "rfq1", requisition_id: "1", status: "closed" }],
    [po("p1", "1", "received"), po("p2", null, "issued")],
    [inv("i1", "p1"), inv("i2", "p2")],
    NOW,
  );
  assert.equal(purchases.length, 2);
  const withRequest = purchases.find((p) => p.request)!;
  assert.deepEqual([withRequest.rfqs.length, withRequest.orders.length, withRequest.invoices.length], [1, 1, 1]);
  assert.equal(withRequest.number, "REQ-1");
  const orphan = purchases.find((p) => !p.request)!;
  assert.equal(orphan.number, "PO-p2");
  assert.equal(orphan.invoices[0].id, "i2");
});

test("overdue deliveries sort first and become urgent tasks", () => {
  const purchases = buildPurchases(
    [req("1", "ordered", { updated_at: "2026-10-24" }), req("2", "ordered", { updated_at: "2026-01-01" })],
    [],
    [po("a", "1", "issued", { required_by_date: "2026-12-01" }), po("b", "2", "issued", { required_by_date: "2026-10-01" })],
    [],
    NOW,
  );
  assert.equal(purchases[0].request!.id, "2");
  assert.equal(purchases[0].overdue, true);
  const tasks = buildTasks(purchases, all, "me", NOW);
  assert.equal(tasks[0].urgent, true);
  assert.match(tasks[0].verb, /overdue/);
});

test("tasks only appear for permissions the user holds", () => {
  const purchases = buildPurchases(
    [req("1", "submitted"), req("2", "approved")],
    [],
    [po("p", "2", "issued")],
    [],
    NOW,
  );
  const grnOnly = buildTasks(purchases, (k) => k === "procurement.grn.create", "me", NOW);
  assert.deepEqual(grnOnly.map((t) => t.action.type), ["receivePO"]);
  assert.equal(buildTasks(purchases, () => false, "me", NOW).length, 0);
  const approver = buildTasks(purchases, (k) => k === "procurement.requisition.approve", "me", NOW);
  assert.deepEqual(approver.map((t) => t.action.type), ["approveRequest"]);
});

test("draft requests are only the requester's own task", () => {
  const purchases = buildPurchases([req("1", "draft", { created_by: "someone-else", requested_by: "someone-else" })], [], [], [], NOW);
  assert.equal(buildTasks(purchases, all, "me", NOW).length, 0);
  assert.equal(buildTasks(purchases, all, "someone-else", NOW).length, 1);
});

test("an approved request with no PO asks for a PO, or for quotes when a quote request is open", () => {
  const plain = buildTasks(buildPurchases([req("1", "approved")], [], [], [], NOW), all, "me", NOW);
  assert.deepEqual(plain.map((t) => t.action.type), ["createPO"]);
  const quoting = buildTasks(buildPurchases([req("1", "approved")], [{ id: "r", requisition_id: "1", status: "issued" }], [], [], NOW), all, "me", NOW);
  assert.deepEqual(quoting.map((t) => t.action.type), ["openPurchase"]);
});

test("invoice tasks: check first, then pay; approved invoices drop off", () => {
  const base = (i: Row) => buildTasks(buildPurchases([req("1", "ordered")], [], [po("p", "1", "received")], [i], NOW), all, "me", NOW).map((t) => t.action.type);
  assert.deepEqual(base(inv("i", "p")), ["checkInvoice"]);
  assert.deepEqual(base(inv("i", "p", { match_status: "matched", status: "matched" })), ["approvePayment"]);
  assert.deepEqual(base(inv("i", "p", { match_status: "matched", status: "approved" })), []);
});
