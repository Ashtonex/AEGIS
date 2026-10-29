# Tender automation: sourcing, review → QS handover, new-tender email

Builds on [e-GP discovery and intake](EGP_TENDER_DISCOVERY.md) (migration 275).
Migration: `imperium-api/migrations/276_tender_intake_workflow.sql`.
Code: `imperium-api/app/services/tenders/` (`workflow.py`, `notify.py`, `pipeline.py`, `egp/collect.py`),
`imperium-api/routers/tender_workflow.py`, cron `imperium-api/scripts/run_tender_automation.py`.
UI: tender record → **Review** tab; **CRM → Tenders & Bids → Tender automation** (`/dashboard/crm/tenders/automation`).

## Sourcing (e-GP)

AEGIS reads e-GP exactly as an anonymous visitor does - no login:

| What | Where | Login? |
|---|---|---|
| Bulletin Board | `/Indexes/index` | no |
| Notice (incl. bid security amount, establishment & SPOC fees when shown) | `/Indexes/viewLiveTenderDetails/{id}` | no |
| Document list | `/Tenders/tender_doc_view/{id}/{id}` requested as the notice page's "Preview" popup (XMLHttpRequest) | no |
| Activity schedule (pre-bid meeting, clarification, closing) | `/Tenders/tender_shedule/{id}` as the "View all activity" popup | no |
| Document downloads | `/privateUploads/downloads/?id=..&h=..` (links from the popup) | no |

Checked 2026-10-28. The supplier login page has a CAPTCHA; AEGIS never automates it and
stores no e-GP password. If e-GP ever puts these behind the login, the run records
`access_restricted` and the admin view shows it.

Other sources: `crm.tender_sources.auth_mode` (`public` / `credentials` / `manual_session`)
and `credential_env_prefix` (credentials live only in `<PREFIX>_USERNAME` / `<PREFIX>_PASSWORD`
environment variables - never in the database, logs or email). A connector for a new
portal is written per source once its URL is known.

**Schedule:** the cron entry (see `scripts/README-cron.md`) runs every 15 minutes; each
organisation only runs when its own interval (Tender automation settings) is due:
re-verify the connection → discovery run → auto-import notices in the chosen relevance
bands (strong by default; possible duplicates of existing tenders are never merged - they wait
in the discovery queue) → collect documents and schedule → workflow → emails. Email
retries also run there. "Run now" on the admin page does the same immediately.

**Collection** (`egp/collect.py`): fills a tender field only when it is empty or came from
the source; anything a person entered is kept and a disagreement is listed as a discrepancy.
Each listed document is downloaded (≤30 MB, type-checked), stored in the `documents`
bucket and linked to the tender; failures are recorded per document (retried up to 3 times,
"Re-collect from e-GP" resets that). The schedule's pre-bid meeting is recorded with
attendance **not confirmed** - the schedule can say "Not Required" while the bidding
document demands a compulsory site visit (seen on Bindura-Shamva and Ruya-Centenary).

## Workflow

`Tender Captured → Pending Tender Review → Pending QS Verification → QS Preparation`, with
`Returned for Correction` looping back to review. Stored in `crm.tenders.review_workflow_status`;
the bid `stage` stays *Tender Identified* and moves to *Bid Prep* when the QS verifies.

Every new tender - auto-imported, imported by a person, or typed in on the board - starts it.
Tenders that existed before can be started from their Review tab (workflow admin).

1. **Initial review** - reviewers from settings (seeded: Ekow, Marvellous). Shared queue: one
   primary by round robin, the other supporting; both get a task. The 8-item checklist (verify
   source, obtain documents, upload missing ones, check files, deadline + submission
   requirements, site visit, bid bond, discrepancies) - each *done* or *not applicable with a
   reason*.
2. **Gate** (server-side): every item resolved; the facts behind each "done" are actually
   recorded (deadline set; site visit rule required/optional/not required, and a date when
   required; bid bond form); documents attached if the document items are done; explicit
   confirmation. Review/QS tasks can't be completed or deleted from the Tasks page, workflow
   columns can't be set through the generic tender API, and the stage can't move to Bid Prep
   or later before QS verification.
3. **QS handover** - QS from settings (seeded: Tagu, Gamuchirai), rule `round_robin` (default),
   `least_loaded` or `fixed`. In-app notification + QS verification task.
4. **QS verify or return** - return needs correction notes, can reopen checklist items, creates
   a correction task for the primary reviewer; the resubmission goes back to the same QS.
5. **QS preparation** - tasks for the site visit (when required and upcoming), BOQ pricing, and
   clarifications (when outstanding items or QS notes exist).

Every transition, checklist change, detail edit (old/new values), collection and assignment is
in `crm.tender_workflow_events` (shown as History on the Review tab).

## New-tender email

One email per tender per address (`crm.tender_notification_deliveries`, unique). Recipients
(settings `notify_user_ids`): **company** = the AEGIS login through `EMAIL_REDIRECTS`
(`ashton@admin.com` → `admin@sixnineconstruction.com`); **private** = the mailbox behind the
person's Teams guest account (`core.users.teams_account`), else `hr.employees.personal_email`.
Seeded: Gloria (nyasha@) and Cosmas - company + private; administrator - company. An address
that can't be resolved is an `unresolved` row shown in the admin view; everyone else still
gets the email. Temporary failures (Resend 429/5xx, network) retry with backoff (5 attempts);
the admin can retry a failed delivery. The email lists what is still awaiting manual
verification and never contains credentials.

## Permissions (migration 276)

| Permission | Granted to |
|---|---|
| `tender_workflow.review` | Executive (Admin), Tender / Bid Manager, CRM Associate, Document Controller |
| `tender_workflow.qs` | Executive (Admin), Tender / Bid Manager, Quantity Surveyor |
| `tender_workflow.admin` | Executive (Admin), Tender / Bid Manager |

Acting on a tender also needs the assignment (one of its reviewers / its QS), admins excepted.
Quantity Surveyors also get `tender_bids.read` and `tender_discovery.read`.

## Verification

`scripts/verify_tender_intake_workflow.py` - full flow against an isolated local database
with a fixture portal; storage, email, push and calendar stubbed (refuses a non-local
`DATABASE_URL`). Covers sourcing, no duplicates on re-run, document storage, review tasks,
the gate, round-robin QS, the correction loop, emails to both of Gloria's/Cosmas's addresses,
and failure visibility/retry.
