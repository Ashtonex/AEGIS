# AEGIS ↔ Microsoft 365 Integration — Phase 1

## Plain-English primer

**Microsoft Graph** is the single API Microsoft exposes for every Microsoft
365 service — SharePoint, Outlook/Calendar, Teams, OneDrive, Entra ID, etc.
Instead of AEGIS talking to "SharePoint's API" and "Outlook's API"
separately, it makes one kind of HTTPS call (`https://graph.microsoft.com/v1.0/...`)
for both. That's why one integration layer (`app/services/microsoft/`) can
cover both the document store and the calendar.

**Why AEGIS needs it:** the business decision behind this whole project is
that SharePoint becomes the durable home for SNC's business documents and
Microsoft Calendar becomes the home for scheduled obligations (meetings,
deadlines, renewals), while AEGIS stays the system that *decides* what
happens (permissions, workflow, routing) rather than storing the files or
owning the calendar itself.

**How AEGIS authenticates:** as itself, not as a person. This is called the
**client-credentials flow** — AEGIS's backend proves its own identity with a
tenant ID + client ID + client secret (three non-interactive values), and
Microsoft hands back a short-lived access token good for making Graph calls.
No human ever logs in for this; there's no "AEGIS user" in Microsoft 365.

**Entra App Registration:** think of this as *registering AEGIS as an
application* with Flectēre's Microsoft 365 tenant, the same way you'd
register a new user account — except it's an application identity, not a
person. It's created once in the Entra admin center (see `SETUP_GUIDE.md`)
and gets its own ID and secret.

**Tenant ID:** the unique ID of the Flectēre Microsoft 365 organisation
itself (every Microsoft 365 customer is a "tenant"). Every Graph call is
scoped to one tenant.

**Client ID:** the unique ID of the AEGIS app registration *within* that
tenant — this is how Microsoft knows which application is calling.

**Client secret:** a password-like value that proves the caller really is
that app registration, not an impersonator. Treated exactly like a database
password: never committed to git, never sent to the browser, rotated
periodically. A certificate is Microsoft's more-secure alternative to a
secret (a private key instead of a shared secret) — not used here for
simplicity, see `SETUP_GUIDE.md`.

**Graph permissions:** a fixed catalog of capabilities Microsoft defines —
"read/write SharePoint sites", "read/write calendars", etc. An app
registration can only do what it's been granted, nothing more.

**Delegated vs. application permissions** — this is the single most
important distinction in this whole integration:

- **Delegated**: "let this app act as the *currently signed-in user*,
  limited to what that user could already do." Requires a human to sign in
  and consent. This is what a "Connect your Outlook" button uses (see the
  existing `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` in
  `core/config.py`, used by `routers/crm_integrations.py` for exactly that
  feature — a *different*, pre-existing, unrelated app registration).
- **Application**: "let this app act as *itself*, with no signed-in user,
  scoped to whatever an admin explicitly granted it." This is what AEGIS's
  SharePoint/Calendar integration uses — there's no per-salesperson consent
  screen, because there's no user in the loop at all. AEGIS reads/writes
  SharePoint and the calendar as a service, on behalf of whichever AEGIS
  user's *own AEGIS permissions* already allowed the action (AEGIS checks
  that separately — see the security model below).

These two are **deliberately separate app registrations** in this project
(new env vars `MICROSOFT_GRAPH_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET`,
distinct from the pre-existing `MICROSOFT_CLIENT_ID`/`CLIENT_SECRET`). Mixing
them would mean the "connect your own Outlook" feature's app registration
would need to also hold `Sites.Selected`, silently widening what a
compromised or misused delegated-OAuth flow could reach.

**Admin consent:** application permissions are powerful enough that a
regular user can't self-approve them — a Global Administrator (or
equivalent) must click "Grant admin consent" once, tenant-wide, after the
permissions are added to the app registration.

**SharePoint site permissions:** by default, an application permission like
`Sites.ReadWrite.All` would let AEGIS touch *every* SharePoint site in the
tenant. `Sites.Selected` (used here) instead grants *zero* sites by default;
an admin then explicitly authorises the app on just the one SNC site via a
separate Graph call (see `SETUP_GUIDE.md` Step 5). This is the Graph
platform's own least-privilege mechanism, not something AEGIS has to
enforce itself.

**Calendar permissions:** `Calendars.ReadWrite` as an application permission
lets AEGIS create/update/cancel events on *any* mailbox in the tenant in
principle — Graph has no per-mailbox equivalent of `Sites.Selected` for
calendars. This is why AEGIS's own code additionally restricts itself to
exactly one configured `calendar_owner_id`/`calendar_id` per organisation
(`core.organisation_integrations`) rather than ever taking a mailbox
identifier from user input.

**What must never reach browser/client-side code:** the client secret, any
Graph access token, and the tenant/client IDs are not secret by themselves
but serve no purpose in the browser either. `aegis-web` (the Next.js
frontend) never imports anything from `app/services/microsoft/` — every
Graph call happens inside `imperium-api` (FastAPI), reached only through
AEGIS's own authenticated REST API (`routers/integrations_microsoft.py` and,
in a later phase, a documents/calendar API), which returns only the results
a permission-checked AEGIS user is allowed to see.

---

## Why a shared mailbox/group calendar, not a personal one (Phase 13)

A dedicated user's own calendar was considered and rejected: it ties the
"company calendar" to one employee's account (breaks if they leave), and
delegated access to a personal calendar is a messier permission model than
an application permission against a resource nobody personally owns. A
**shared mailbox** (e.g. `operations@flectere.onmicrosoft.com`) or a
**Microsoft 365 Group calendar** (e.g. an "SNC Operations" group) are both
real Exchange calendars reachable the same way through Graph, don't belong
to any one person, and are the recommended pattern here — pick whichever
already exists or is easier for your organisation to administer. A
SharePoint site's own "Calendar" list is explicitly **not** used: it's an
older, SharePoint-only list type, not a real Exchange calendar, doesn't
generate Outlook/Teams meeting invites, and isn't reachable through the same
Graph calendar endpoints.

---

## What exists today (this phase)

| Piece | Status |
|---|---|
| `core.organisation_integrations`, `core.sharepoint_folder_map`, `core.calendar_event_map`, dual-provider columns on `core.file_attachments` | ✅ Migrated (`imperium-api/migrations/219_microsoft_graph_integration_foundation.sql`) |
| App-only Graph auth, retry/backoff, circuit breaker, typed errors | ✅ `app/services/microsoft/auth.py`, `graph_client.py`, `errors.py` |
| SharePoint site discovery, library/folder listing, folder creation, small + large file upload, download URL, version history | ✅ `app/services/microsoft/sharepoint.py` |
| Calendar list/create/update/cancel | ✅ `app/services/microsoft/calendar.py` |
| Module → library routing rules, project folder template | ✅ `app/services/microsoft/routing.py` |
| Document upload orchestration (Phase 8) into the existing `core.documents`/`core.file_attachments` registry | ✅ `app/services/microsoft/document_service.py` |
| Calendar event upsert/cancel with idempotency (Phase 14/16/17/18) | ✅ `app/services/microsoft/calendar_service.py` |
| Setup wizard API (Phase 24) — status, test connection, discover site, list libraries/folders, map libraries, list/select calendar, permission test, toggle sync, disconnect | ✅ `routers/integrations_microsoft.py`, mounted at `/api/v1/integrations/microsoft` |
| Setup wizard **UI** (Settings → Integrations → Microsoft 365 page in `aegis-web`) | ⬜ Not built yet |
| A real upload endpoint wired to `document_service.upload_document` from an actual module (e.g. a "push to SharePoint" button on a project's Documents panel) | ⬜ Not built yet |
| CRM/Tenders/Projects/Compliance/Finance/Plant/HR calendar-event integration (Phase 15/16 per-module triggers) | ⬜ Not built yet |
| Durable retry/dead-letter for a failed SharePoint upload (Phase 22's "Pending Microsoft Sync" staged-fallback) | ⬜ Not built yet — currently a failed upload raises immediately rather than queuing for retry |
| Migration tool (Supabase Storage → SharePoint, Phase 12) | ⬜ Not built yet |
| Frontend document viewer/version history panel, executive calendar view (Phase 19/20) | ⬜ Not built yet |
| Automated tests (Phase 27) | ⬜ Not built yet — everything above has been verified to import and compile cleanly, but has not been exercised against a real Microsoft tenant (no credentials exist yet) |

Nothing above touches or removes Supabase Storage — every existing
`provider='supabase'` document keeps working exactly as before; SharePoint
is strictly additive (`provider='sharepoint'`).

## Data ownership (Phase 29)

- **AEGIS** (this repo): workflow, permissions, routing decisions, audit,
  which module a document belongs to, which AEGIS record a calendar event
  represents.
- **Supabase**: application data, auth, RLS, realtime, the
  `organisation_integrations`/`sharepoint_folder_map`/`calendar_event_map`
  metadata tables, and any document that hasn't (yet, or ever needs to)
  move to SharePoint.
- **SharePoint**: the actual durable file bytes and their version history,
  once a document is `provider='sharepoint'`.
- **Microsoft Calendar**: the actual calendar entry and any Outlook/Teams
  meeting invitation it generates.

## Security model (Phase 23)

1. Every Graph call happens server-side in `imperium-api`, authenticated as
   the app-only service principal — never with a value from the browser.
2. `Sites.Selected` limits the blast radius of a compromised secret to the
   one SNC site an admin explicitly authorised, not the whole tenant.
3. AEGIS's own `require_permission("integrations.microsoft.manage")` /
   `require_permission("integrations.microsoft.read")` guard every setup
   endpoint, and `require_permission("documents.microsoft.sync")` will guard
   the upload endpoint once it exists — a human being denied a document in
   AEGIS is checked *before* any Graph call is made on their behalf; AEGIS's
   own permission check, not Microsoft's, is what a viewer's access
   ultimately depends on.
4. No secret, certificate, or access token is ever persisted in a database
   table — see `core/config.py`'s `MICROSOFT_GRAPH_*` settings and
   `SETUP_GUIDE.md`.
