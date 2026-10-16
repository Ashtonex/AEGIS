# AEGIS Data Integrity Checks & Verification Queries

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Reliability Engineer  
**Scope**: Read-only verification queries to detect schema orphans, missing tenant boundaries, invalid financial states, and inventory imbalances.

---

## 1. Tenancy Isolation Integrity Checks

### Check 1.1: Detect Records Missing `organization_id`
Any row in core domain tables without a valid `organization_id` is an orphaned record that risks leaking or being hidden from authenticated queries:
```sql
SELECT 'projects' AS entity, COUNT(*) FROM projects.projects WHERE organization_id IS NULL
UNION ALL
SELECT 'inventory_items', COUNT(*) FROM procurement.inventory_items WHERE organization_id IS NULL
UNION ALL
SELECT 'stock_ledger', COUNT(*) FROM procurement.stock_ledger WHERE organization_id IS NULL
UNION ALL
SELECT 'purchase_orders', COUNT(*) FROM procurement.purchase_orders WHERE organization_id IS NULL
UNION ALL
SELECT 'cost_transactions', COUNT(*) FROM finance.cost_transactions WHERE organization_id IS NULL
UNION ALL
SELECT 'users', COUNT(*) FROM core.users WHERE organization_id IS NULL;
```
*Expected Result*: 0 rows across all tables.

---

## 2. Inventory & Stock Ledger Reconciliation Checks

### Check 2.1: Detect Negative Stock Balances by Item and Store
Stock must never be negative in an honest warehouse ledger:
```sql
SELECT 
    i.id AS item_id,
    i.item_code,
    i.item_name,
    st.name AS store_name,
    SUM(sl.quantity) AS net_balance
FROM procurement.stock_ledger sl
JOIN procurement.inventory_items i ON i.id = sl.item_id
LEFT JOIN procurement.stores st ON st.id = sl.store_id
GROUP BY i.id, i.item_code, i.item_name, st.name
HAVING SUM(sl.quantity) < 0;
```
*Expected Result*: 0 rows.

### Check 2.2: Verify Stock Transfer Pairing (Out vs. In)
Every `transfer_out` must have an identical positive `transfer_in` under the same `source_id`:
```sql
SELECT 
    source_id AS transfer_id,
    SUM(quantity) AS transfer_sum
FROM procurement.stock_ledger
WHERE movement_type IN ('transfer_out', 'transfer_in')
GROUP BY source_id
HAVING SUM(quantity) <> 0;
```
*Expected Result*: 0 rows (net transfer sum must be exactly 0).

---

## 3. Financial & Budget Reconciliation Checks

### Check 3.1: Reconcile Purchase Order Commitments vs. Invoice Line Spend
Detect cases where billed invoice lines exceed approved purchase order commitments without an authorized amendment:
```sql
SELECT 
    po.id AS po_id,
    po.po_number,
    po.total_amount AS po_total,
    COALESCE(SUM(inv.total_amount), 0) AS invoiced_total,
    COALESCE(SUM(inv.total_amount), 0) - po.total_amount AS variance
FROM procurement.purchase_orders po
LEFT JOIN procurement.supplier_invoices inv 
    ON inv.source_po_id = po.id AND inv.organization_id = po.organization_id
WHERE po.status = 'approved'
GROUP BY po.id, po.po_number, po.total_amount
HAVING COALESCE(SUM(inv.total_amount), 0) > po.total_amount;
```
*Expected Result*: Any variance must map to an approved change order or override log.

---

## 4. Workforce & Site Attendance Checks

### Check 4.1: Detect Duplicate Attendance Records for Same Employee on Same Day
```sql
SELECT 
    employee_id,
    attendance_date,
    COUNT(*) AS records_count
FROM hr.attendance
GROUP BY employee_id, attendance_date
HAVING COUNT(*) > 1;
```
*Expected Result*: 0 rows (unique constraint enforced on `(employee_id, attendance_date)`).
