# e-GP Tender Discovery and Intake

Finds notices on the official Zimbabwe PRAZ e-GP portal, stages them for
review with field-level evidence, and imports the chosen ones into the
existing tender pipeline (`crm.tenders`, `/dashboard/crm/tenders`).

UI: **CRM → Tenders & Bids → e-GP Discovery** (`/dashboard/crm/tenders/discovery`).
API: `/api/v1/tender-discovery/*` (`imperium-api/routers/tender_discovery.py`).
Code: `imperium-api/app/services/tenders/egp/` (portal, parser, matching, discovery, intake).
Schema: `imperium-api/migrations/275_egp_tender_discovery_intake.sql`.

## Official source

| Item | Value |
|---|---|
| Portal | `https://egp.praz.org.zw`, linked as "eGP System" from `https://www.praz.org.zw` (checked 2026-10-26) |
| Public pages used | Bulletin Board `/Indexes/index` (search form + `?page=N`), notice page `/Indexes/viewLiveTenderDetails/{id}` |
| Popups (no login) | Document list `/Tenders/tender_doc_view/...` and activity schedule `/Tenders/tender_shedule/...` answer anonymous XMLHttpRequests, as the notice page's own buttons send them; document download links need no session (re-checked 2026-10-28 - see [TENDER_INTAKE_WORKFLOW.md](TENDER_INTAKE_WORKFLOW.md)) |
| API / export | None published. RSS on praz.org.zw is news only |
| robots.txt | None (404) |
| Terms | Supplier terms allow notice information to be used/stored only to evaluate an opportunity or prepare a response. AEGIS keeps it internal and never republishes it |

The connector only fetches that one host over HTTPS, waits ≥3 s between
requests, retries timeouts and 5xx at most 3 times with backoff, and stops
the run on HTTP 429/403, a CAPTCHA or a login page. It never persists or logs
portal cookies.

## Connection states

`connected_verified` is set only after the live Bulletin Board's notice table
was actually parsed; the probe also records the notice count and checks the
portal clock against Africa/Harare (UTC+2). `access_restricted` and
`connection_error` record what really happened. `awaiting_user_login` and
`session_expired` belong to an authenticated session, which this deployment
does not hold (see limitations) - the UI shows the document tier as
"Not connected" with the reason.

## How it works

1. **Connect e-GP** - probes the live board.
2. **Run discovery** - walks every page in scope (optional portal filters:
   title phrase, supplier category name/code, procuring entity id, publish
   and closing date ranges), scores each row against the profile, opens the
   notice page for strong/possible matches (and for every imported notice),
   stores each field with its source URL, section, excerpt and time. Each page
   is a checkpoint; an interrupted or partial run is resumed from the next
   unread page. Outcomes distinguish *no matching tenders (all pages read)*
   from *portal listed nothing*, *access failed*, *restricted* and *partial*.
3. **Review** - queue with relevance (strong/possible/weak, every point
   explained) kept separate from readiness (unverified / requirements missing /
   ready for internal decision). Correct fields (with a note), assign the
   responsible person and internal review date, defer, reject (reason
   required) or import; select several to import at once.
4. **Import** - creates (or links) the `crm.tenders` row at stage
   *Tender Identified* with source identity; published requirements
   (`source = EGP_PUBLISHED`, with excerpts) and SNC's internal checklist
   (`source = SNC_INTERNAL`) as separate `crm.tender_requirements`; decision
   and document tasks in `crm.tasks`; the standard stage task pack and
   calendar deadline; audit log + domain event; in-app notification to the
   responsible person. Idempotent: unique index on
   `(organization_id, source_key, source_notice_id)`, keyed requirements and
   task dedupe keys. A tender with the same reference/title/URL is flagged for
   a person to link or import as new - never merged silently.
5. **Recheck** - re-reads an imported notice; differences are stored as
   pending changes with old/new values and evidence (closing date, addenda,
   attachments, categories, status, other amendments, page disappearing).
   Nothing touches the tender until someone applies a change; applying never
   overwrites a field the user has edited. The responsible person gets an
   in-app notification (no email).
6. **Documents** - sign in to e-GP yourself, download the bidding documents,
   attach them on the notice (PDF, Word, Excel, images; max 30 MB). Text is
   extracted by the existing document job; a document only counts as
   reviewed when extraction succeeded.

## Permissions (migration 275)

| Permission | Granted to |
|---|---|
| `tender_discovery.read` | Executive (Admin), Tender / Bid Manager, CRM Associate, Commercial Manager, Executive Read Only |
| `tender_discovery.run` | Executive (Admin), Tender / Bid Manager, CRM Associate, Commercial Manager |
| `tender_discovery.import` | same as run (import also needs `crm.create_tenders`; attaching needs `documents.create`) |
| `tender_discovery.configure` | Executive (Admin), Tender / Bid Manager |

## Limitations

- Superseded by migration 276: documents and the activity schedule are now
  collected automatically without a login (see TENDER_INTAKE_WORKFLOW.md).
  Site-visit attendance rules and bid-security form/validity still come from
  the bidding documents and are confirmed by the initial reviewer.
- No OCR: scanned PDFs are flagged as "no text", not reviewed.
- No SNC credentials are configured in the corporate credentials vault yet,
  so every notice shows eligibility as missing evidence.
- `crm.tenders.site_visit_mandatory` is NOT NULL (default false); for an
  imported notice "false" means *not known*, and an internal checklist item
  asks the reviewer to confirm.
- Discovery runs in the API process after the request returns. If the API
  restarts mid-run the run is closed as *partial / interrupted* after 10
  minutes without a heartbeat and can be resumed.
- Scheduled rechecks are not enabled: the setting is refused unless the
  background worker is enabled on the deployment.

## Verification scripts

- `tests/test_egp_parser_and_matching.py` - parser, scoring, portal client (fixtures, no network, no DB).
- `scripts/verify_egp_tender_intake.py` - full flow against an isolated local database (refuses any non-local `DATABASE_URL`).
- `scripts/live_check_egp_portal.py --pages 2 --details 4` - conservative live read of the real portal, writes only to an isolated local database.

## First real discovery and import

1. Apply migration 275 (auto-applied on the next backend deploy to `main`).
2. Sign in to AEGIS as Executive (Admin) or Tender / Bid Manager.
3. Open **CRM → Tenders & Bids → e-GP Discovery** and click **Connect e-GP**;
   confirm the state is *Connected and verified* with the live notice count.
4. Optionally review the **Profile** tab ("SNC Civil Works").
5. Click **Run discovery** without filters (about 40 pages, ~2-4 minutes);
   check the run says *completed* - or *partial* with the reason - before
   relying on the queue.
6. Open a strong notice, read the evidence and missing items, set the
   responsible person and review date, and **Import into pipeline**; follow
   the "Open saved tender" link and confirm it is on the Tenders & Bids board.
7. Sign in to e-GP in your own browser, download the bidding documents and
   attach them on the notice; then use **Recheck notice** before deadlines.
