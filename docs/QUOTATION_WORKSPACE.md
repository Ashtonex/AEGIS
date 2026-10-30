# Quotation Estimating Workspace

One workspace per quotation for the whole estimating flow: particulars, BOQ,
drawings, rates, commercial review, frozen revisions and documents, award and
handoff. It reads and writes the existing record (`finance.quotations`, BOQ in
`metadata.items`) through the same server endpoints and controls as the
classic builder, which stays available.

UI: **Quotations → (row) Open estimating workspace** → `/dashboard/quotations/{id}?section=overview|boq|drawings|rates|commercial|revisions|handoff`.
API: `imperium-api/routers/quotations.py` (workspace block at the end of the file).
Domain: `imperium-api/app/services/quotations/workspace.py`; documents: `app/services/documents/quotation_documents.py`.
Frontend: `aegis-web/src/components/quotations/workspace/`, page `aegis-web/src/app/dashboard/quotations/[id]/page.tsx`.
Schema: `imperium-api/migrations/279_quotation_workspace_revisions.sql`.

## Lifecycle (as found, and what the workspace adds)

| Stage | Record | Control (server) |
|---|---|---|
| Draft estimate | `status='draft'`, `metadata.items` | `quotations.update`; edits blocked once `won`/`lost` |
| Internal BOQ approval | `metadata.boq_approval` (`POST /{id}/boq-approval`) | `quotations.decide`; author cannot approve own BOQ; editing approved lines resets it to `pending_review` |
| **Freeze revision** (new) | `finance.quotation_revisions` (immutable) | `quotations.update`; *issued* needs approval of the current lines and no blocking flags; moves `draft → sent` |
| Client copy uploaded via CRM | `status='sent'`, `metadata.client_copy` | unchanged (`crm.opportunities.quote`) |
| Award / loss | `POST /{id}/decision` | `quotations.decide`; author cannot mark won; every `blocks_quotation_win` SOP complete. **New:** optional `revision_id` - the budget seeds from that issued revision's frozen snapshot |
| Handoff | project budget + BOQ lines (existing), procurement plan (existing), **materials schedule package** (new) | budget seeding guards unchanged; package idempotent per (quotation, revision) |

Internal approval, client issue, client acceptance (award) and project
creation stay separate. Internal approval never marks anything won.

## Server guarantees added

- **Server-authoritative totals.** Every create/save with BOQ lines re-prices
  through `QuotationCalculator`; `quote_amount` and the stored totals are the
  server's. Browser totals are a labelled preview. Records without lines (hand
  entered client-copy amounts) keep their amount.
- **Effective-dated VAT.** The rate comes from Finance › Statutory
  `vat_output` table effective on the quote date, frozen on the record as
  `metadata.vat_rate` / `vat_rate_source`. With no table configured the
  long-standing 15.5% still applies (so existing quotes do not change price)
  but the source reads `legacy_default` and Commercial Review flags it.
- **Stable line identity.** Each line gets `line_id` (separate from the
  editable `item_no`), preserved on every save; diffs match on it.
- **Optimistic concurrency.** `row_version` is bumped by a trigger on every
  UPDATE from any writer. A save that sends `expected_row_version` (or
  `If-Match`) and is stale gets `409 {code: STALE_VERSION}`; nothing is
  overwritten. Callers that send no version (classic builder) keep
  last-write-wins.
- **Closed bypasses.** A plain save or create can no longer set `won`/`lost`
  (that skipped four-eyes and SOP gates). `convert-to-project` on a quotation
  not yet won now applies the same author and SOP gates. `POST /quotations`
  strips server-owned metadata (`boq_approval`, `client_copy`,
  `uploaded_boq`, `revision_state`), so "Duplicate" no longer copies an
  approval.
- **Immutable revisions.** A trigger rejects UPDATE/DELETE on
  `finance.quotation_revisions`. Further editing changes the working draft.
  Re-issuing identical figures returns the existing revision.
- **Note lines.** `item_type='note'` (headings, exclusions, clarifications)
  price at zero in the calculator mapping, budget BOQ seeding and the
  procurement plan.

## Calculation (unchanged) and how it is shown

`QuotationCalculator`: line amount = round(qty × rate, 2); overhead,
contingency and profit are each a % of (direct + preliminaries), not
compounded; provisional sums added after markups; discount before tax; tax on
the discounted subtotal. Commercial Review shows each step with its base and:

- cost = direct + preliminaries + overhead + contingency + provisional sums
- realised profit = selling value excl. tax − cost (so discount reduces it)
- **markup = profit ÷ cost**, **margin = profit ÷ selling value excl. tax**

Low-margin warning reuses the CCB's existing 10% profit floor
(`QuotationBrain`); the 40%/25% profit/overhead alerts are the calculator's own.

## Revision comparison

Matched on `line_id` (older snapshots without ids fall back to section + code
+ description). For a line in both: quantity effect = ΔQ × old rate, rate
effect = ΔR × old qty, interaction = the rest of the rounded amount movement
(ΔQ × ΔR plus that line's cent rounding). Added/removed lines carry their full
amount. The five columns sum exactly to the calculator's direct-cost delta;
any residue would be shown as "unattributed rounding" (verified 0).

## Documents

Generated from a frozen revision only (`GET /{id}/revisions/{rev}/documents/...`):

- `client-pdf`: company and client details, reference + revision, date and
  validity, priced schedule by section with **selling rates** (cost rate ×
  (1 + overhead% + contingency% + profit%), cents rounded; the rounding residue
  is absorbed into the preliminaries line, or a rounding line if there are no
  preliminaries, so the schedule equals the server total), provisional sums,
  discount, VAT with rate, total, inclusions/exclusions/assumptions, payment
  terms, programme if given, acceptance block. No cost rates, build-ups,
  markups or margins.
- `internal-xlsx`: labelled INTERNAL; commercial build-up with markup and
  margin, BOQ cost lines with line ids and rate sources, resource build-ups.

The pre-existing `/exports/pdf` "quotation" PDF exposes profit, overheads and
internal cost guidance; it is unchanged and should be treated as internal.

## Handoff

`GET /{id}/handoff` reads what exists: linked project, approved budget seeded
from this quotation, active project BOQ lines, procurement plan stage/draft
requisition, planning packages. `POST /{id}/handoff/materials-schedule` (won
quotations awarded on a named revision; `quotations.decide`) aggregates the
awarded revision's material build-ups (BOQ qty × per-unit qty), merging only
identical name + unit + specification, keeping every source line. Unique on
(quotation, revision, package type): retries, double clicks and concurrent
calls return the one package. It creates no requisition, PO or commitment. No
cash-flow forecast is derived from the quotation total.

## Rollout

1. Apply `migrations/279_quotation_workspace_revisions.sql` and
   `migrations/280_quotation_rate_templates.sql` **before** deploying the
   backend (the update endpoint selects `row_version`; templates use the new
   assembly columns). Both are additive and idempotent (each applied twice on
   the local replica). Existing rows get `row_version = 1`.
2. Deploy the backend, then the frontend. The workspace is on by default;
   build the frontend with `NEXT_PUBLIC_QUOTATION_WORKSPACE=off` to hide it
   (`aegis-web/src/components/quotations/workspace/flags.ts`).
3. Optional: configure a `vat_output` USD rate table in Finance › Statutory so
   new saves stop using the legacy default.

## Rollback

- UI only: rebuild the frontend with `NEXT_PUBLIC_QUOTATION_WORKSPACE=off`.
  The classic builder keeps working on the same records.
- Backend: reverting the code is safe with the migration left in place (the
  old code ignores `row_version` and the new tables). Revisions and packages
  remain as history. Do not drop `finance.quotation_revisions` once
  revisions have been issued - they are the issued record.
- Saved quotations keep `line_id`, `vat_rate`, `vat_rate_source`,
  `calculation_alerts` and `revision_state` keys in metadata; older code
  ignores them. Note: the reverted calculator mapping would price VAT at
  15.5% again instead of the frozen rate.

## Verification

- `imperium-api/tests/test_quotation_workspace.py` - 16 unit tests: line ids,
  VAT mapping, note lines, markup vs margin bases, discount effect, variance
  reconciliation (incl. legacy ids), line flags, client schedule reconciliation
  across discount/no-prelims/provisional/no-VAT, client PDF free of internal
  figures, 400-line pagination, internal workbook, materials aggregation.
- `imperium-api/scripts/verify_quotation_workspace.py` - end-to-end through the
  real FastAPI app (permission dependencies included) on the isolated local
  database (refuses any non-local `DATABASE_URL`): 69 checks across existing
  records, server totals, VAT, governance rejections (403/409), revisions,
  immutability trigger, documents, award from revision, budget reconciliation,
  duplicate-safe handoff with a simulated failure and concurrent repeats,
  stale-save conflicts (5 concurrent saves → exactly one wins), and a
  1,000-line estimate.
- `imperium-api/tests/test_quotation_rate_sources.py` - template conversion
  (validation, legacy recipe mapping, built-in recipe = legacy unit rate).
- `imperium-api/scripts/verify_quotation_rate_sources.py` - 34 checks on the
  isolated database: each source's value and exclusions (draft/cancelled POs,
  expired cards, retired plant, small trades), resolve after price changes and
  deletion, template permission, versioning, validation, and 5 concurrent
  saves of one code → versions 1..5 with one current row. Seeds tagged rows
  and deletes them afterwards.

## Live rate sources (migration 280)

In the line inspector each build-up resource has **Price from inventory / PO
/ fleet / labour** (`GET /quotations/rate-sources?q=&resource_type=`,
`app/services/quotations/rate_sources.py`):

| Source | Value used | Notes |
|---|---|---|
| Inventory | unit price ex VAT, else standard cost | stock items record no currency - shown as "not recorded", never guessed |
| Purchase order | newest priced line for the stock item (approved / issued / received / invoiced / closed POs) | draft and cancelled POs ignored; unit price ex VAT |
| Rate card | active `procurement.vendor_rate_items` in their effective dates | material, transport (with route), service → subcontractor |
| Fleet | own plant: hourly operating cost **and** internal charge rate, offered separately | retired / disposed plant excluded |
| Site labour | median hourly rate of active site workers per trade + currency | only trades with ≥ 3 workers, no names, so no individual's pay is exposed |

Picking a source fills cost, unit, currency, source label and date and keeps
`source_type` / `source_ref` on the resource. A different unit or currency is
shown, never converted. Typing a cost by hand unlinks the source.

**Rates → Refresh linked prices** looks every linked resource up again
(`POST /quotations/rate-sources/resolve`), shows old → new per source, the
lines affected and the direct-cost impact, and flags a source that no longer
exists. Selected changes update the resources; a line whose rate equalled its
build-up follows it, a line with a typed rate keeps it. Saved like any edit.

## Build-up templates (migration 280)

- **Apply template** lists the org's templates (current version per code)
  and the built-in recipes (`GET /quotations/rate-templates`). Built-in
  recipes are converted with their wastage % folded into material quantities
  and are labelled as unsourced. Applying **copies** the resources into the
  line and records `buildup_template {id, code, version}`; the line rate only
  changes when the estimator uses "Use build-up".
- **Save as template** (`POST /quotations/rate-templates`, needs
  `quotations.manage_assemblies` - QS / executive) stores the build-up per one
  unit with its sources in `finance.construction_assemblies.resources`, and
  fills the legacy recipe columns for material/labour/plant so the CCB
  assembly calculator still works (wastage 0, as it is already in the
  quantities). Saving an existing code inserts version n+1 and retires the old
  row (`is_deleted`, `superseded_by`), serialised per code by an advisory
  lock. Templates never change a quotation that already used them.

## Classic builder

The classic builder now sends `expected_row_version`. If the quotation
changed since it was opened and only server-owned fields moved (BOQ approval,
client copy, computed totals), it retries once at the new version; if anything
the builder edits changed, it stops with "Your changes have NOT been saved"
and a Reload button. It also keeps unknown line keys (`line_id`, `item_type`,
`rate_source`, `takeoff`, source links), so a classic save no longer strips
workspace data, and reloads the server's line ids after each save.

## Limitations

- Multi-currency: one currency per estimate. A build-up resource priced in
  another currency is flagged; no FX conversion is stored or applied.
- Rate sources: inventory items carry no currency; fleet rates are own plant
  only (hired-in plant agreements are not offered); labour is a median of
  current site workers, not a payroll cost including on-costs.
- Templates: the legacy CCB "custom assembly" form still inserts its own rows
  without versioning; the newest row per code is shown.
- Drawings: measuring, extraction and checklists stay on the Drawing Takeoff
  page; the workspace imports measurements and tracks committed / draft /
  superseded status per line.
- Lump sums are entered as qty 1 × amount; alternates are not modelled.
- Concurrency protection applies to the workspace and the classic builder;
  other writers (CRM client-copy upload, decisions) are server actions that
  do not overwrite lines.
- Approval of an *issued* revision is the existing BOQ approval; there is no
  separate commercial-manager sign-off tier.
