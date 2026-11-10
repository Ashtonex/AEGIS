// Run: node --test src/components/procurement/supplierOrders.test.ts   (Node >= 22.6 strips the types)
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allocationProblem, assignSupplier, groupBySupplier, initialAllocations, needsReason,
  quoteOptions, requestLines, splitRow, toPayload, type Row,
} from "./supplierOrders.ts";

const pr: Row = {
  id: "req1",
  lines: [
    { id: "l1", description: "Cement 50kg", quantity: "100", unit_of_measure: "bag", estimated_unit_cost: "12.5", quantity_ordered: 0 },
    { id: "l2", description: "Y12 rebar", quantity: "40", unit_of_measure: "length", estimated_unit_cost: "9", quantity_ordered: "40" },
    { id: "l3", description: "River sand", quantity: "6", unit_of_measure: "m3", estimated_unit_cost: "30", quantity_ordered: "2" },
  ],
};
const rfqs: Row[] = [{
  id: "rfq1", requisition_id: "req1", status: "closed",
  responses: [
    { id: "q1", supplier_id: "halsteds", supplier_name: "Halsteds", status: "received", line_items: [{ description: "cement 50KG ", unit_price: 11 }] },
    { id: "q2", supplier_id: "bhola", supplier_name: "Bhola", status: "received", line_items: [{ description: "Cement 50kg", unit_price: 10.5 }, { description: "River sand", unit_price: 28 }] },
    { id: "q3", supplier_id: "gone", supplier_name: "Gone", status: "rejected", line_items: [{ description: "Cement 50kg", unit_price: 1 }] },
  ],
}];

test("lines show what is still to order; fully ordered lines get no allocation row", () => {
  const lines = requestLines(pr);
  assert.deepEqual(lines.map((l) => l.remaining), [100, 0, 4]);
  const rows = initialAllocations(lines);
  assert.deepEqual(rows.map((r) => [r.lineId, r.quantity, r.unitPrice]), [["l1", "100", "12.5"], ["l3", "4", "30"]]);
});

test("quotes match by description, cheapest first, rejected quotes ignored", () => {
  const options = quoteOptions({ description: "Cement 50kg" }, rfqs);
  assert.deepEqual(options.map((o) => [o.supplierId, o.unitPrice]), [["bhola", 10.5], ["halsteds", 11]]);
});

test("a quoted supplier brings their price; changing to an unquoted one drops the quote link", () => {
  const lines = requestLines(pr);
  const [row] = initialAllocations(lines);
  const quoted = assignSupplier(row, "halsteds", quoteOptions(lines[0], rfqs));
  assert.deepEqual([quoted.unitPrice, quoted.responseId], ["11", "q1"]);
  const other = assignSupplier(quoted, "someone", quoteOptions(lines[0], rfqs));
  assert.deepEqual([other.unitPrice, other.responseId], ["11", null]);
});

test("split cement across two suppliers: one PO each, quantities checked against what is left", () => {
  const lines = requestLines(pr);
  let rows = initialAllocations(lines);
  rows = rows.map((r) => (r.lineId === "l1" ? { ...r, quantity: "60" } : r));
  rows = splitRow(rows, rows[0].key, lines);
  assert.equal(rows[1].quantity, "40", "the split takes what the first row leaves");
  const q = quoteOptions(lines[0], rfqs);
  rows = [assignSupplier(rows[0], "bhola", q), assignSupplier(rows[1], "halsteds", q), assignSupplier(rows[2], "bhola", quoteOptions(lines[2], rfqs))];
  assert.equal(allocationProblem(rows, lines), null);
  const groups = groupBySupplier(rows);
  assert.deepEqual(groups.map((g) => [g.supplierId, g.rows.length, g.subtotal, g.quoted]), [["bhola", 2, 60 * 10.5 + 4 * 28, true], ["halsteds", 1, 440, true]]);
  assert.equal(needsReason(rows), false);

  const over = rows.map((r, i) => (i === 1 ? { ...r, quantity: "41" } : r));
  assert.match(allocationProblem(over, lines)!, /only 100 bag is still to order/);
  const twice = rows.map((r, i) => (i === 1 ? { ...r, supplierId: "bhola" } : r));
  assert.match(allocationProblem(twice, lines)!, /same supplier twice/);
});

test("lines without a supplier are left for later; an unquoted price needs a reason", () => {
  const lines = requestLines(pr);
  const rows = initialAllocations(lines);
  assert.match(allocationProblem(rows, lines)!, /at least one line/);
  const one = [assignSupplier(rows[0], "someone", []), rows[1]];
  assert.equal(allocationProblem(one, lines), null);
  assert.equal(needsReason(one), true);
  const payload = toPayload(one, "  Only stockist in Mutare  ");
  assert.deepEqual(payload, {
    lines: [{ requisition_line_id: "l1", supplier_id: "someone", quantity: 100, unit_price: 12.5, rfq_response_id: null }],
    selection_reason: "Only stockist in Mutare",
  });
});
