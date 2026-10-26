# AEGIS System Repair Register

Statuses: UNTESTED / FAILED / IN PROGRESS / BLOCKED / VERIFIED / NOT APPLICABLE.
Evidence for every VERIFIED entry is in `SYSTEM_VERIFICATION_REPORT.md`.
REG-001..020 are deployed (commits 755d66a..5eb36e5, 2026-10-26). REG-010 and REG-022..025 are in the working tree, not yet committed.

## Repairs

### REG-001 - P0 - Winning/linking an unpriced quotation wiped the project budget - VERIFIED (code) / data BLOCKED (DEC-002)
- **Workflow / role:** B→C quotation decision, convert-to-project, link-project; Commercial / QS.
- **Reproduction (production evidence):** quotation `602beea4` (0 BOQ items) marked won on 2026-10-22 → TBTS4 got approved budget v15 = **$0.00**, superseding the real budget, and all 100 active BOQ lines were superseded. Same pattern on 3 more projects (Trout Beck entrance road, Berry Armstrong, Muchabayawi).
- **Expected:** an unpriced quotation never replaces a budget or BOQ.
- **Root cause:** `routers/quotations.py` decision/convert/link paths called `seed_project_budget_from_quotation` with no priced-items guard (CRM and tender paths had one); `seed_boq_line_items_from_quotation` superseded active lines before checking the new quotation had any. Convert/link also wrapped seeding in `try/except: log` without a savepoint, so a failure could commit a superseded budget with no replacement.
- **Repair:** shared `quotation_budget_block_reason()` used by every quotation seed path; `seed_project_budget_from_quotation` raises `UnpricedQuotationError` on a $0 execution total; BOQ seeding leaves active lines alone when the quotation has no measurable lines; swallowed exceptions removed (failure rolls the whole request back). Responses carry `budget_pending_reason`, shown in the existing UI messages.
- **Verification:** `scripts/verify_quotation_decision.py` scenario B; `scripts/verify_quotation_budget_sync.py` unpriced refusals; `tests/test_quotation_budget_seeding_guards.py`.
- **Remaining:** 4 projects still carry $0 approved budgets → DEC-002, script prepared at `imperium-api/migrations/manual/2026-10-26_restore_budgets_overwritten_by_unpriced_quotations.sql` (ends in ROLLBACK; not run).

### REG-002 - P1 - "Sync from Quotation" invented budgets from the sell price - VERIFIED
- **Workflow / role:** C project budget; QS / PM.
- **Reproduction:** `extract_quotation_cost_breakdown` fell back to a 45/25/15/10/5 % split of `quote_amount` (sell price incl. profit) when no breakdown existed, and used its own estimator that disagreed with the win path (TBTS4 history shows 158,606 vs 208,170 vs 204,840 for the same quotation).
- **Root cause:** two independent budget calculators; fabricated fallback.
- **Repair:** import, preview (eligible-quotations) and category summary all use `QuotationCalculator` + `quotation_budget_lines()`; no invented split; unpriced → 422 with a clear message.
- **Verification:** live-data runs for EHTRW, TBTS4, TCT-2026-014, BC-CM (rolled back); unit tests.

### REG-003 - P1 - Sync from Quotation partial writes and raw path ref - VERIFIED
- **Root cause:** after resolving the project (id, code or name), the endpoint still passed the raw path value to BOQ seeding and the project UPDATE; BOQ errors were caught inside the same transaction, leaving it aborted (→ 500) or partially written.
- **Repair:** resolved UUID used throughout; no swallowed exceptions; project row locked `FOR UPDATE`; idempotent repeat (`already_current`).
- **Verification:** EHTRW called by **code** succeeds; repeat import creates no extra version.

### REG-004 - P1 - Lump-sum quotation lines priced at $0 - VERIFIED
- **Reproduction:** EHTRW's quotation `fd131fea` stores lines as `{description, amount}` only; the calculator read them as $0 and BOQ seeding skipped them.
- **Repair:** `quotation_item_qty_rate()` reads `qty`/`quantity`, and treats amount-only lines as 1 × amount ("sum"); used by calculator input and BOQ seeding.
- **Verification:** EHTRW import → $18,275.90, 6 BOQ lines, lines = header.

### REG-005 - P1 - Sync from Quotation could import another project's quotation - VERIFIED
- **Root cause:** category summary picked the "linked quotation" by client name / client account; Troutbeck has several projects.
- **Repair:** linked quotation = `project.quotation_id` or quotation pointing back at the project only; client matches stay as *suggestions* in the selector; import of a quotation already owned by another project → 409. Category summary now requires `projects.read`.

### REG-006 - P1 - Budget baseline lock bypassed - VERIFIED
- **Root cause:** `POST /projects/{id}/budget` restricts replacing an approved baseline to `projects.budget_baseline.lock` (Finance); Sync from Quotation (`projects.update`), quotation won (`quotations.decide`) and link-project bypassed it.
- **Repair:** shared `protected_budget_block_reason()`; import → 403; decision/link → decision recorded, budget left unchanged with reason. `set_project_budget` now also uses the resolved project id.
- **Verification:** real non-Finance users refused 403 on EHTRW and TCT-2026-014, baseline untouched.

### REG-007 - P2 - Project deep links by code 404 for site users - VERIFIED
- **Root cause:** `require_project_access` compared the path value to visible UUIDs; codes (e.g. `/dashboard/projects/EHTRW`) always failed for users without `projects.read_all`.
- **Repair:** non-UUID refs are resolved by `project_code` within the org before deciding.
- **Verification:** unit tests (assigned code opens; unassigned code and UUID still 404).

### REG-008 - P1 - Duplicate "won" submissions re-seeded budgets - VERIFIED
- **Reproduction:** TBTS4 v14 and v15 both seeded from `602beea4`, 17 s apart.
- **Repair:** decision row locked `FOR UPDATE`; repeating the current decision returns `already_decided` with no side effects (idempotency key completed if supplied).

### REG-009 - P1 - Won auto-link matched projects by client name/account - VERIFIED
- **Root cause:** fallback matched any project of the same client and took the newest; also the SELECT never loaded `opportunity_id`/`tender_id`, so lineage matching could not work.
- **Repair:** lineage only (project points at quotation / same opportunity / same tender) and unambiguous; otherwise unlinked with a reason.

### REG-012 - P1 - Goods receipt could not record partial deliveries, shortages or rejections - VERIFIED
- **Workflow / role:** E procurement, PO → GRN → stock; Storekeeper / Site.
- **Reproduction:** `POST /procurement/goods-received` and the "Record delivery" modal had no line quantities: every GRN booked the full outstanding quantity of every line into stock, whatever actually arrived. `grn_lines.quantity_rejected` / `rejection_reason` existed but were always 0 / empty.
- **Repair:** optional `lines[]` (`quantity_received`, `quantity_rejected`, `rejection_reason`) validated against outstanding quantities (no over-receipt, reason required for rejections, line must belong to the PO, no duplicates); rejected-only lines stay outstanding and never enter stock; omitting `lines` keeps the old full-delivery behaviour. Modal rebuilt with per-line Accepted / Rejected inputs (stacked for phone width) and client-side validation; notice shows the GRN number from the server.
- **Verification:** `scripts/verify_goods_receipt.py PO-000004` steps 1-6 (rolled back); `tests/test_goods_receipt_partial_and_rejections.py`.

### REG-013 - P2 - Concurrent / repeated goods receipts - VERIFIED
- **Root cause:** PO and lines were read without locks; a double submit hit the `quantity_received <= quantity` check at UPDATE and returned a 500 (the constraint prevented overbooking). The same delivery note could be booked twice when lines were partial.
- **Repair:** PO and its open lines locked `FOR UPDATE`; a delivery note reference already recorded on the PO → 409.

### REG-014 - P1 - VAT invoices could never be matched, so they could never be paid - VERIFIED
- **Root cause:** `match_invoice` compared the VAT-inclusive invoice total with the GRN value built from ex-VAT unit prices, and each invoice with the whole PO (ignoring other invoices on it). Payment approval requires `matched`, so any VAT-bearing invoice was blocked forever, while a second invoice for the same delivery could still show `matched`.
- **Repair:** `three_way_match()` compares ex-VAT subtotals, deducts other live invoices on the PO, applies the tolerance the inspection view already documents (≤ $5 and ≤ 1 % of the PO), locks the PO while matching, refuses invoices without a PO (409) or already decided. Inspection `can_approve_payment` now mirrors the server rule exactly (it used to promise approval within tolerance while the server refused).
- **Verification:** unit tests (VAT, partial, over, second invoice, split invoices, tolerance); live chain steps 7-12: matched → second invoice `over_invoice` → approval without evidence 409 → approval with evidence approved, commitment invoiced +56,513.19, GL journal proposed → repeat approval no-op.
- **Caught during verification:** my first version wrote `variance_amount`, which is a generated column (`total_amount - matched_amount`); the live-schema run failed and the write was removed.

### REG-015 - P2 - Duplicate supplier invoice reference returned 500 - VERIFIED
- **Root cause:** the unique constraint is `DEFERRABLE INITIALLY DEFERRED`, so the INSERT-time `except IntegrityError` never fired; the duplicate failed at COMMIT as a 500.
- **Repair:** explicit case-insensitive duplicate check before insert (409 naming the existing invoice) and IntegrityError handling at commit.

### REG-018 - P1 - Daily reports booked 8 h per worker regardless of the labour register - VERIFIED (code) / data: see DEC-003
- **Workflow / role:** D site day → daily report → labour cost; Site Agent / Engineer.
- **Reproduction (production):** 2026-10-19 report shows 88 h for 11 workers who never clocked in; 2026-10-22 (approved) shows 80 h against 30 h in the register; 2026-10-17 104 h vs 0 h.
- **Root cause:** `sync_attendance_to_daily_report` used `COALESCE(a.regular_hours, 8)` and `… or 8` (so 0 also became 8), and the sync at clock-out / close never ran because it read `site_day_briefings.daily_report_id`, a column nothing writes (0 of 17 briefings) - reports kept the placeholder from day start. The `regular + overtime > 0` constraint on report lines is why the placeholder existed.
- **Repair:** report hours mirror the register exactly; people with no recorded hours get no line (a placeholder line created earlier is withdrawn); report found via `daily_site_reports.briefing_id`; only draft/rejected reports are changed (submitted/approved stay as signed); day summary uses recorded hours once clocked out and reports `projected_workers` for people still on site.
- **Verification:** `scripts/verify_site_day_hours.py` - all 10 draft reports re-sync to equal the register (80→0, 88→0, 104→0, 32→21, 168→152, 48.5→32.5 …); approved 10-22 left untouched.

### REG-019 - P1 - Late day close booked 16 h overtime per person into payable time - VERIFIED (code) / data BLOCKED (DEC-003)
- **Reproduction (production):** 2026-10-21 day started 08:14 local, closed 10:06 the next morning → 19 people × (8 h + 16 h OT); 2026-10-16 closed two days later → 24 × (8 + 16). HR accepted them; `finance.site_time_entries` carry **272 OT h (10-21) and 320 OT h (10-16)** - not yet in a pay run (≈ $1,620 at current overtime rates).
- **Root cause:** closing (and individual clock-out) used the current time as everyone's clock-out; `split_hours` caps a shift at 24 h.
- **Repair:** `clock_out_time()` - closing a day shift after its date (night/double: after the next day) requires `left_site_at`; the given time must be after clock-in and not in the future; people who arrived after it get 0 h. Labour Register UI asks "When did people actually leave site?" in that case and disables Close/Out until it's given.
- **Verification:** live 2026-10-23 open day: close without time → 422; with 16:30 → 10 people × 7.75 h, 0 OT, linked report = register (77.5 h). Individual late clock-out without time → 422.

### REG-020 - P2 - Report-sync failures silently aborted the caller's transaction - VERIFIED
- **Root cause:** the sync caught every exception and only logged a warning, after the DB error had already aborted the request's transaction, so the following statements (or the commit) failed with an unrelated error.
- **Repair:** sync runs in its own savepoint and logs at error level with the report id.

### REG-010 - P1 - Push/email sent before commit; expired subscriptions committed the caller's transaction - VERIFIED
- **Root cause:** `emit_notification` called `dispatch_user_pushes` (and urgent email) inline, so people were alerted about records a later failure rolled back; when any push subscription had expired, `dispatch_user_pushes` ran `await db.commit()` on the **caller's** session mid-request, committing half-finished operations.
- **Repair:** `app/shared/notification_delivery.py` - the notification row is still written in the caller's transaction; delivery is queued on the session and starts only after it commits (dropped on rollback), on its own session, and skips any notification whose row did not survive (e.g. a rolled-back savepoint). Subscription clean-up now commits only the delivery session.
- **Verification:** unit tests on a real `Session` (nothing before commit, sent after commit, dropped on rollback, later commit doesn't resurrect); live `scripts/verify_notification_delivery.py`: rollback schedules nothing; commit schedules delivery, which finds no committed row and sends nothing.
- **Limit:** delivery is an in-process task - a process restart in the seconds after commit loses that push (same best-effort level as before, minus the false alerts).

### REG-022 - P1 - Two site pay runs could pay the same hours - VERIFIED
- **Root cause:** `create_site_pay_run` read unpaid entries without locking, then stamped them; two drafts at once both priced the same hours (each run then pays them). Non-USD workers would be posted to the cashbook as USD.
- **Repair:** unpaid entries claimed `FOR UPDATE` before pricing (a waiting request re-checks and skips claimed rows); non-USD workers refused with a clear 422.
- **Verification:** `scripts/verify_site_pay_run.py` - 146 entries claimed once, gross = hours × rates per worker (3,391.38), re-draft 409, pay before approval 409, paid → one cashbook outflow (net) + one labour cost (gross), pay/cancel on paid 409, cancelled draft releases hours.
- **Note:** that live draft includes the overnight hours in DEC-003.

### REG-023 - P1 - Double-submitted stock movements booked twice - VERIFIED
- **Root cause:** manual receipt/issue/transfer/adjustment used a new random `source_id` per request, so the ledger's idempotency key never matched a retry.
- **Repair:** optional client `request_id` becomes the source id; a repeat returns the recorded movement (`already_recorded`). Inventory forms generate one per submission (the store panel rotates it only after a success).
- **Verification:** `scripts/verify_stock_movements.py` - each movement type submitted twice is recorded once.

### REG-024 - P1 - Second issue of an item to a work order / vehicle silently dropped; parts cost collided with work-order cost - VERIFIED
- **Root cause:** those issues used the work order / vehicle id as the ledger source id (unique per source+item), so the second one hit `ON CONFLICT DO NOTHING` while the API said "Stock issue recorded"; the parts cost used the same key as the work-order completion cost, which overwrites on conflict.
- **Repair:** every issue is its own source (`work_order_parts_issue` / `fleet_consumable_issue`, linkage kept in notes). No such rows existed in production.
- **Verification:** two issues of one item to the same vehicle → two ledger rows.

### REG-025 - P1 - Issuing parts to a work order or vehicle always failed with 500 - VERIFIED
- **Root cause:** the inventory reference checker's allow-list lacked `fleet.maintenance_work_orders` / `fleet.fleet` ("Unsupported reference validation"). Scan of the other two checkers found no further gaps.

### Verified without defects
- Requisition → submit → approve (self-approval refused) → PO (rationale required; second PO from the same requisition refused) → Finance then director sign-off (out of order refused; issue before sign-off refused) → issue → exactly one commitment; re-issue refused. `scripts/verify_requisition_to_po.py`.

## Open defects found, not yet repaired

| ID | Sev | Workflow | Finding | Status |
|---|---|---|---|---|
| REG-011 | P2 | B quotations | Frontend `decideQuotation` sends no `Idempotency-Key`; server guard (REG-008) now covers repeats. | IN PROGRESS (server side done) |
| REG-016 | P3 | E procurement | Test invoice INV-000003 on test PO `PO-P8A-TEST-01` is `approved` with `partial_match`, no GRN and no approver - written on 2026-09-12 by an earlier version of the match step; current code cannot produce it. Test data; leave or cancel at Finance's discretion. | NOT APPLICABLE (data note) |
| REG-017 | P3 | E procurement | 45 of 47 supplier invoices have no PO (registered via `inventory.py` / historical import) - they cannot be three-way matched and now get a clear 409 instead of "invoice not found". | UNTESTED (by design?) |

## Decisions required (not invented)

- **DEC-001 - Execution budget cost basis.** Live quotations store **billed rates with margin built in** (e.g. TCT-2026-014: items total 220,928.65 = sell price, cost buildup 150,023.70; EHTRW: lines 18,275.90, recorded `direct_costs` 13,767.54). The documented rule is "budget = direct + prelims + overhead + contingency, excluding profit", but the calculator takes the billed rate when it differs from the buildup. Should the execution budget use the cost buildup / recorded `direct_costs` instead of billed rates? Until decided, the baseline lock (REG-006) keeps non-Finance users from replacing a baseline with a sell-price figure.
- **DEC-002 - Restore the four $0 budgets.** Which version each project returns to (TBTS4: v11 $204,686.57 protected baseline or v13 $180,560.36 from fe46f2cf; Trout Beck entrance road v1; Berry Armstrong v1; Muchabayawi has no earlier budget). Script prepared, not run.

- **DEC-003 - Correct the overnight hours already accepted.** Site time entries for 2026-10-16 (320 OT h, 30 entries) and 2026-10-21 (272 OT h, 17 entries) come from days closed late (REG-019); they are not in a pay run yet. Only site can say when people actually left. Until corrected they will be paid in the next site pay run. Draft daily reports for those days mirror the same register hours.
- **DEC-004 - The approved 2026-10-22 daily report** records 80 h against 30 h in the register (REG-018). It was signed, so it was not changed automatically; reopen/reject it if the 80 h is wrong.

- **DEC-005 - Stock valuation method.** Issues, transfers and count adjustments take the unit cost typed into the form (default 0). Production's 4 transfers moved 128 units at $0, so value stays in the source store while the units move; stock issued to a project at $0 would post $0 actual cost. Choose a method (e.g. weighted average of receipts per store) before issues start - no issue movements exist yet.
- **DEC-006 - Segregation on site pay runs.** Supplier payment batches and requisitions block the creator from approving; site pay runs let one person draft, approve and pay. Decide whether wage runs need the same rule.

## Next workflows in priority order

1. F finance posting / reversal / period close flows.
2. H plant & fleet (allocation, usage, work orders end to end); I compliance & documents.
3. J executive dashboards traced to source; K portals.
4. Material requests (0 in production) and PO cancellation / returns.
