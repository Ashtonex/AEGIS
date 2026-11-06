// Run: node --test src/components/procurement/deliveries.test.ts   (Node >= 22.6 strips the types)
import assert from "node:assert/strict";
import { test } from "node:test";

import { deliveryBucket, matchesDeliverySearch, outstandingLines, sortedOpenDeliveries, type Row } from "./deliveries.ts";

const NOW = new Date(2026, 10, 6, 15, 0, 0); // 6 Nov 2026, 15:00 local
const po = (id: string, status: string, due: string | null, extra: Partial<Row> = {}): Row => ({ id, status, po_number: `PO-${id}`, supplier_name: "Halsteds", required_by_date: due, ...extra });

test("buckets by calendar day, not by hour", () => {
  assert.equal(deliveryBucket(po("a", "issued", "2026-11-05"), NOW), "overdue");
  assert.equal(deliveryBucket(po("b", "issued", "2026-11-06"), NOW), "today");
  assert.equal(deliveryBucket(po("c", "issued", "2026-11-13"), NOW), "week");
  assert.equal(deliveryBucket(po("d", "issued", "2026-11-14"), NOW), "later");
  assert.equal(deliveryBucket(po("e", "issued", null), NOW), "undated");
  assert.equal(deliveryBucket(po("f", "issued", "not a date"), NOW), "undated");
});

test("only orders sent to the supplier and not fully received are listed, overdue first", () => {
  const rows = [
    po("later", "issued", "2026-12-01"),
    po("draft", "draft", "2026-11-01"),
    po("done", "received", "2026-11-01"),
    po("undated", "partially_received", null),
    po("late", "issued", "2026-11-02"),
    po("today", "issued", "2026-11-06"),
  ];
  assert.deepEqual(sortedOpenDeliveries(rows, NOW).map((r) => r.id), ["late", "today", "later", "undated"]);
});

test("outstanding lines subtract what already arrived", () => {
  const order = po("x", "partially_received", null, {
    lines: [
      { id: "1", description: "Cement", quantity: "100", quantity_received: "60" },
      { id: "2", description: "Sand", quantity: 10, quantity_received: 10 },
    ],
  });
  assert.deepEqual(outstandingLines(order).map((l) => [l.id, l.outstanding]), [["1", 40]]);
});

test("search covers PO number, supplier, project and line descriptions", () => {
  const order = po("x", "issued", null, { project_name: "Trout Beck", lines: [{ id: "1", description: "IBR roof sheets" }] });
  assert.ok(matchesDeliverySearch(order, "po-x"));
  assert.ok(matchesDeliverySearch(order, "halsteds"));
  assert.ok(matchesDeliverySearch(order, "trout"));
  assert.ok(matchesDeliverySearch(order, "roof"));
  assert.ok(!matchesDeliverySearch(order, "cement"));
});
