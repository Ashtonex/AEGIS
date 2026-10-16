# AEGIS Security Baseline & Tenancy Policy

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  

---

## 1. Zero Trust Multi-Tenancy Rules
1. **JWT as the Single Source of Tenant Identity**: Every request must extract `organization_id` strictly from the cryptographically verified JWT payload (`user["org_id"]`). Client-supplied headers, query parameters, or body keys must never dictate tenant scope.
2. **Mandatory Query Parameterization**: Raw SQL statements must bind tenant parameters via `:org_id`. Under no circumstances may query strings be constructed using f-strings, `%` formatting, or dynamic concatenation.
3. **Child Table Parent Joins**: For child entities lacking an `organization_id` column (e.g., `supplier_invoice_lines`, `maintenance_work_orders`), queries must perform an inner join against a verified tenant-scoped parent table (`procurement.supplier_invoices`, `fleet.fleet`).

---

## 2. RBAC & Privilege Escalation Defenses
1. **Seeded Permission Keys**: Every permission referenced in `@router` decorators must exist as a pre-seeded record in `core.permissions`. Unseeded strings fail CI verification via `test_permission_registry_contract.py`.
2. **No Silent Admin Defaults**: Unknown users or missing permissions must result in immediate HTTP 403 Forbidden. The application must never silently assign default administrative or employee roles.
3. **Audited Override Gates**: Emergency operational overrides (budget releases, site diary waivers) require verified membership in `BUDGET_OVERRIDE_ROLES`, an explicit text reason of ≥ 10 characters, and an immutable audit event emitted to `core.audit_events`.

---

## 3. Storage & Object-Level Access (IDOR Prevention)
1. **Private Buckets by Default**: All Supabase Storage buckets containing engineering drawings, supplier invoices, site photos, and contracts must remain private.
2. **Authenticated Pre-Signed URLs**: Direct public URLs to file assets are prohibited. Downloads must route through authenticated API proxy endpoints that verify user tenant membership before generating short-lived (≤ 60s) pre-signed download tokens.
