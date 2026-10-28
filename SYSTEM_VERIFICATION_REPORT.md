# AEGIS System Verification Report

How each claim was checked. "Rolled back" = run against the production
database inside one outer transaction that is always rolled back, with
push/email stubbed (`imperium-api/scripts/_rollback_harness.py`); production
row counts were compared before and after.

## 2026-10-25/26 - Quotation → project budget chain

### Live-data workflow runs (rolled back)

`scripts/verify_quotation_budget_sync.py EHTRW TBTS4 TCT-2026-014 BC-CM` - ALL PASSED
- EHTRW (called by project **code**): non-Finance user → 403, baseline untouched; Finance → approved budget $18,275.90, lines = header, 6 BOQ lines; repeat → `already_current`, no new version; 3 unpriced quotations → 422, budget untouched.
- TBTS4: linked quotation `602beea4` (0 items) → 422 "no BOQ line items", budget untouched.
- TCT-2026-014: non-Finance → 403; Finance → $220,928.65, lines = header, 72 BOQ lines; repeat idempotent.
- BC-CM (no linked quotation) → 404 with "Choose & Link Quotation" guidance.

`scripts/verify_quotation_decision.py` - ALL PASSED, 0 outbound calls attempted
- A repeat "won" on `602beea4` → `already_decided`, no budget version added.
- B unpriced `2bfa9c02` won on a project with no budget → no budget, reason returned.
- C priced `3ca75ff6` won on a project with a baseline: non-Finance blocked (SOP gate 409), baseline untouched; Finance → new budget, lines = header (196,908.92), 11 BOQ lines.
- D quotation sharing only a client name → not auto-linked.

Production after all runs: `finance.project_budgets` 30, `budget_lines` 92, `boq_line_items` 318 (identical to before), 0 new `core.domain_events`, 0 new `core.notifications`.

### Read-only data integrity checks (production)
- Posted journals: 0 unbalanced, 0 header/line mismatches, 0 posted without lines.
- Duplicate source postings: 2 sources, both post → reverse → re-post pairs (net single posting).
- Stock ledger: 0 negative store/item positions.
- Approved budgets at $0 seeded from quotations: 4 projects (REG-001 / DEC-002).

### Automated checks
- `pytest tests` (imperium-api): **1443 passed, 29 skipped, 0 failed** (run after REG-001..007; REG-008 and the scope test change re-checked with the targeted files below).
- `pytest tests/test_quotation_budget_seeding_guards.py tests/test_project_scope.py tests/test_projects_router_contract.py tests/test_project_forecast_bridge.py tests/test_quotation_*` : pass.
- `ruff check --select F821 .` : all checks passed. F841 warnings in `routers/projects.py` are pre-existing (same 4 before the change).
- Frontend: no frontend files changed in this batch; existing UI shows the server `message`, which now carries the "budget left unchanged" reason.

### Test changes
- New `tests/test_quotation_budget_seeding_guards.py` (21 tests): unpriced guard, no BOQ wipe, lump sums, lines = header, no invented split, resolved id / no swallowed errors, lineage-only auto-link, baseline lock, repeat decision, project-code scope.
- `tests/test_projects_router_contract.py::test_quotation_cost_breakdown_extractor_unit` rewritten: it asserted the old estimator (stored breakdown / keyword guessing), which is the defect in REG-002; it now asserts the canonical calculator result and that an unpriced quotation yields 0.
- `tests/test_project_scope.py::test_unassigned_project_is_not_found` gives the function a stub session (code lookup needs one) and adds a UUID case; the 404 assertions are unchanged.

## 2026-10-26 - Procurement: PO → GRN → stock → invoice → match → payment

`scripts/verify_goods_receipt.py PO-000004` (rolled back, outbound stubbed) - ALL PASSED (23 checks)
1. Partial receipt: line 1 +18.000, rejected-only line stays outstanding, rejection + reason stored on the GRN line, PO `partially_received`, stock ledger +18.000.
2. Rejection without reason → 422. 3. Over-receipt → 422 ("receiving 37 but only 18 outstanding"). 4. Same delivery note (different case/spaces) → 409.
5. Remaining order (lines omitted) → every line fully received, PO `received`, stock +4,413.000 = outstanding, once-off items provisioned for 27 uncatalogued lines. 6. Further receipt → 409.
7. Invoice registered. 8. Duplicate supplier reference (different case) → 409. 9. Match → `matched`. 10. Second invoice for the same delivery → `over_invoice`.
11. Approval without evidence → 409; with PO/GRN/invoice/approval evidence → approved, commitment invoiced +56,513.19, GL journal proposed. 12. Repeat approval → no-op.

Production after the run: 0 GRNs, 47 supplier invoices, 228 stock-ledger rows, 2,502 journals, commitments invoiced 0.00/0.00, PO-000004 still `issued`, 0 notifications - unchanged.

Automated: `tests/test_goods_receipt_partial_and_rejections.py` (10), `tests/test_supplier_invoice_three_way_match.py` (10); `test_procurement_verification_contract.py::test_match_invoice_header_logic_is_untouched` repointed from the old literal formula (`matched_amount = min(`) to the corrected matcher - its intent (advisory checks stay out of match status) is still asserted.

Frontend: `npx tsc --noEmit` clean; `npm run build` exit 0. The new receive modal has not been exercised in a browser (needs a signed-in session; submitting from the UI would commit to production).

## 2026-10-26 - Site day: labour register → daily report → payable hours

Read-only reconciliation (production) of register vs report per site day found the 8 h placeholder (REG-018) and the 24 h shifts from late closes (REG-019); 272 + 320 OT hours sit in unpaid `finance.site_time_entries`.

`scripts/verify_site_day_hours.py` (rolled back, push/email stubbed) - ALL PASSED (17 checks)
- Re-sync of all 11 site-day reports: 10 draft reports now equal their register exactly; the approved 2026-10-22 report is left as signed.
- Late individual clock-out without a time → 422; late close without a time → 422.
- Close of the still-open 2026-10-23 day with "left 16:30": 10 people clocked out at 16:30 local, 7.75 h each, 0 OT, linked report 77.5 h = register.
- First run of this script exposed REG-020 (swallowed sync error aborting the transaction) - fixed and re-run.

Production after the run: 159 report labour lines, 13 open clocks, 2026-10-23 still `started`, 0 notifications - unchanged.

Automated: `tests/test_site_day_hours_truth.py` (10) plus site/HR time suites (47 total) pass. Frontend: `tsc --noEmit` clean.

## Final checks for this batch (2026-10-26)
- `pytest tests` (imperium-api): **1477 passed, 29 skipped, 0 failed**.
- `scripts/sql_explain_check.py` against the live schema (read-only, rolled back): 2,198 statements, **FAILURES: 0**.
- `ruff check --select F821` : clean. `aegis-web`: `tsc --noEmit` clean, `npm run build` exit 0.

## 2026-10-26 (batch 2) - Notifications, site pay run, stock movements, requisition → PO

All rolled back with push/email stubbed; production counts checked after.
- `scripts/verify_notification_delivery.py` - ALL PASSED (rollback schedules nothing; post-commit delivery finds no committed row → nothing sent).
- `scripts/verify_site_pay_run.py` - ALL PASSED (11 checks).
- `scripts/verify_stock_movements.py` - ALL PASSED; its first run exposed REG-025 (work-order/vehicle issues always 500).
- `scripts/verify_requisition_to_po.py` - ALL PASSED (13 checks, no defects).
- New tests: `test_notification_delivery_after_commit.py`, `test_site_pay_run_claims.py`, `test_stock_movement_idempotency.py`.
- Full checks: `pytest tests` **1490 passed, 29 skipped, 0 failed**; SQL health check 2,201 statements, **FAILURES: 0**; `ruff --select F821` clean; `npm run build` exit 0.
- Production after the runs: stock ledger 228, site pay runs 0, unpaid time entries 166, requisitions 1, POs 2, commitments 2 - unchanged. The 48 notifications created in the window are the 04:00/06:00 scheduled jobs and one real HR confirmation, none from these runs.

## 2026-10-26/28 - e-GP tender discovery and intake (new feature, not deployed)

Isolated environment: a local PostgreSQL 16 cluster built from production's
schema (catalog read only - no rows, no personal data) plus a synthetic
organisation/users; migration 275 applied there twice (idempotent). Production
was never written: after all runs `crm.tenders` still 50 live / 57 total, and
no migration-275 objects exist there.

- `tests/test_egp_parser_and_matching.py` - **20 passed** (fixtures: pagination, login shell/CAPTCHA, hidden and commented-out values ignored, missing/untimed closing dates, board-vs-notice conflicts, scoring/eligibility, host allowlist, 429 not retried, bounded 5xx retries, pacing).
- `scripts/verify_egp_tender_intake.py` (isolated DB, fixture portal) - **73/73 PASS**: authorisation; connection states from real responses; full/partial/resumed runs with no duplicates; no-matches vs empty board vs access failed vs restricted vs page cap; failed notice extraction stays unverified; import persists, appears in `/crm/tenders`, published vs internal checklist, tasks, audit, notification; reimport/retry idempotent; uncertain match flagged then linked; recheck keeps user edits, change history with evidence, apply/acknowledge; withdrawn notice flagged; failed-extraction document not "ready"; `.exe` rejected; no cookies stored; no email sent.
  Its first runs found and fixed: checkpoint skipping past a failed page (resume would have lost it), a `varchar`/`text` bind clash in task creation, test-reset order.
- **Live portal (read-only GETs, isolated DB)** `scripts/live_check_egp_portal.py --pages 2 --details 4`: probe verified 792 notices / 40 pages, portal clock UTC+2 = Africa/Harare; 2 pages read, run labelled partial (page cap); 1 notice opened and imported into the isolated DB with 6 published + 5 internal checklist items. 2026-10-28 UI run: 928 notices / 47 pages, 2 pages, 2 notice pages read, no failures.
- **Browser (isolated API + production build, `next start`)**: authenticated workspace, Re-verify, Run discovery with live progress, review drawer with provenance, owner + review date saved, import, tender visible on Tenders & Bids after reload with deadline, checklist and e-GP chip; read-only user sees no run/import controls. Found and fixed: the drawer footer sat under the app's release banner (z-index).
- SQL health check against the migrated isolated schema: 2,245 statements; the single failure is `hr/performance.py` reading `auth.users.last_sign_in_at`, absent from the local auth stub (not a production failure). All e-GP SQL plans.
- `pytest tests` (imperium-api): **1510 passed, 29 skipped, 0 failed**. `ruff --select F821` clean. `aegis-web`: `tsc --noEmit` clean, `npm run build` exit 0.

Not verified: authenticated e-GP access (not supported by design - see docs/EGP_TENDER_DISCOVERY.md); document upload from the browser (needs a real Supabase session; attach path verified at API level); a full 40+ page live run; behaviour on the production database before migration 275 is applied.

## Verification limits
- No isolated dev/test database exists; all mutation tests are rollback-only against production.
- Browser end-to-end runs not yet performed for this batch (backend-only change).
- Not deployed: changes are uncommitted on `main`; deploying = pushing `imperium-api/**` to `main`.
