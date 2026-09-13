# Microsoft 365 Integration — Setup Guide (Phase 25)

This is the human-side setup AEGIS's code cannot do for you: creating the
Entra (Azure AD) app registration Flectēre's tenant admin controls, granting
it permissions, and telling AEGIS which SharePoint site and calendar to use.
Everything else (the Graph client, the setup wizard API, the database
schema) is already built and waiting for the values you collect here.

You will need **Global Administrator** or **Privileged Role Administrator**
access to the Flectēre Microsoft 365 tenant to complete Steps 1–5 (admin
consent specifically requires this). If that isn't you, do Steps 1–4, then
hand the "Grant admin consent" click to whoever is.

---

## Step 1 — Open Microsoft Entra admin center

Go to **https://entra.microsoft.com** and sign in with a Flectēre admin
account. This is the current (2025+) name for what used to be called "Azure
Active Directory" — if you land in the older `portal.azure.com` blade
instead, that's fine too, the same object is called "App registrations"
there.

## Step 2 — Create the AEGIS app registration

1. In the left sidebar: **Identity → Applications → App registrations**.
2. Click **+ New registration**.
3. **Name:** `AEGIS - SharePoint & Calendar Integration` (or similar — this
   is just a label, it doesn't affect anything technical).
4. **Supported account types:** *Accounts in this organizational directory
   only (Flectēre only - Single tenant)*.
5. **Redirect URI:** leave this **blank**. This app registration will only
   ever authenticate as itself (client-credentials / app-only flow) — it
   never signs in a human, so it needs no redirect URI. (This is a different
   app registration from whatever one, if any, backs the existing CRM
   "connect your Outlook" feature — that one *does* need a redirect URI. Do
   not reuse it here; see `docs/microsoft365-phase1/README.md` for why they
   must stay separate.)
6. Click **Register**.

## Step 3 — Collect the Tenant ID and Client ID

On the app's **Overview** page, copy:

- **Application (client) ID** → this is `MICROSOFT_GRAPH_CLIENT_ID`
- **Directory (tenant) ID** → this is `MICROSOFT_GRAPH_TENANT_ID`

Paste both into a scratch note for now — you'll add them to AEGIS's
environment variables in Step 9.

## Step 4 — Create a client secret

1. Left sidebar (still inside the app registration): **Certificates &
   secrets**.
2. **Client secrets** tab → **+ New client secret**.
3. Description: `AEGIS production` (or `AEGIS staging` if this is a
   non-production tenant/app).
4. Expiry: pick your organisation's rotation policy — 12 or 24 months is
   typical. **Set a calendar reminder for before it expires** — an expired
   secret fails closed (the integration reports "not configured"), it does
   not silently degrade.
5. Click **Add**, then **immediately copy the secret's Value** (not the
   Secret ID) — Microsoft only shows this once. This is
   `MICROSOFT_GRAPH_CLIENT_SECRET`.

> A certificate is also supported by Microsoft as an alternative to a
> client secret and is somewhat more secure, but adds real operational
> complexity (cert storage, rotation tooling) for a single-tenant internal
> integration. A client secret, rotated on the schedule above and never
> committed to git, is the pragmatic choice here.

## Step 5 — Add the required Graph permissions (application, not delegated)

1. Left sidebar: **API permissions** → **+ Add a permission** → **Microsoft
   Graph** → **Application permissions** (not "Delegated permissions" — this
   distinction matters, see the explanation below).
2. Add these permissions:

   | Permission | Why AEGIS needs it |
   |---|---|
   | `Sites.Selected` | Read/write files in *specifically the SNC SharePoint site* — not every site in the tenant. This is the least-privilege choice; see the note below. |
   | `Calendars.ReadWrite` | Create/update/cancel events on the one shared mailbox or group calendar you select in Step 8. |

   Do **not** add `Sites.ReadWrite.All` or `Calendars.ReadWrite` scoped
   tenant-wide unless your organisation has already decided broader access
   is acceptable — `Sites.Selected` deliberately limits AEGIS to only the
   sites an admin explicitly grants it (next step), so a bug or leaked
   secret in AEGIS cannot read *every* SharePoint site in the tenant.

3. Click **Add permissions**.
4. Click **Grant admin consent for Flectēre**, confirm. Both permissions'
   status column should turn to a green checkmark ("Granted for Flectēre").
   **This step requires the admin role mentioned at the top of this guide** —
   if the button is greyed out, you don't have it; ask someone who does.

### Granting `Sites.Selected` access to the specific SNC site

`Sites.Selected` alone grants the app *zero* sites until you explicitly
authorise one. This is done via a Graph API call, not a portal button — it's
a one-time setup step:

1. Find the SNC site's ID first (you'll also need this in Step 6/9 — Step 6
   below shows the easiest way to get it via AEGIS's own setup wizard once
   Steps 1–5 here are done, or via
   `GET https://graph.microsoft.com/v1.0/sites?search=SNC`).
2. Grant the app registration `write` access to that one site with a Graph
   call like:

   ```
   POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
   Content-Type: application/json

   {
     "roles": ["write"],
     "grantedToIdentities": [{
       "application": {
         "id": "{MICROSOFT_GRAPH_CLIENT_ID from Step 3}",
         "displayName": "AEGIS - SharePoint & Calendar Integration"
       }
     }]
   }
   ```

   The easiest way to run this one-time call is **Graph Explorer**
   (https://developer.microsoft.com/graph/graph-explorer), signed in as a
   SharePoint/site admin: paste the URL and JSON body above, method `POST`,
   and run it. You only need to do this once per site.

## Step 6 — Locate the SNC SharePoint site

You have two options:

**Option A (recommended) — use AEGIS's own setup wizard** once
`MICROSOFT_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET` are set (Step 9) and the
backend is redeployed:

- `GET /api/v1/integrations/microsoft/discover-sites?query=SNC`
  (as a signed-in AEGIS admin) — this searches every site the app
  registration can see and returns each one's `site_id`, `name` and
  `web_url`. Pick the one matching `SNC_Controlled_Data` /
  `SNC — Controlled Data Room`.

**Option B — manually via the SharePoint site itself:** open the site in a
browser, then open `https://<hostname>/sites/<site-name>/_api/site/id` (a
SharePoint REST endpoint) while signed in — it returns the site's GUID,
though not in the exact `hostname,siteGuid,webGuid` composite form Graph's
`sites/{id}` endpoint expects, so Option A is more reliable.

## Step 7 — Select the document libraries

Still via AEGIS's setup wizard, once the site is connected
(`POST /api/v1/integrations/microsoft/connect` with the `site_id`/`drive_id`
from Step 6):

- `GET /api/v1/integrations/microsoft/sites/{site_id}/libraries` — lists the
  site's document libraries (drives). If `00_DIRECTORS`, `01_FINANCE`, etc.
  are folders inside one library rather than separate libraries, use
  `GET /api/v1/integrations/microsoft/drives/{drive_id}/folders` instead to
  list top-level folders and match them to the module keys AEGIS uses (see
  `app/services/microsoft/routing.py`'s `MODULE_LIBRARY_MAP`).
- `PUT /api/v1/integrations/microsoft/library-map` with a body like:

  ```json
  { "library_map": { "01_FINANCE": "<driveItem id>", "03_PROJECTS": "<driveItem id>", ... } }
  ```

## Step 8 — Select the calendar

Decide which mailbox owns the shared operational calendar (see
`docs/microsoft365-phase1/README.md` for the reasoning — a **shared mailbox**
or a **Microsoft 365 Group** is recommended over any one person's own
calendar).

1. In the Microsoft 365 admin center (https://admin.microsoft.com) →
   **Teams & groups** (or **Users → Shared mailboxes**), find or create the
   mailbox/group (e.g. `operations@flectere.onmicrosoft.com` or an
   "SNC Operations" Microsoft 365 Group) and copy its **email address** (for
   a shared mailbox/user) or **object ID** (for a group, under the group's
   own **Overview** page).
2. `GET /api/v1/integrations/microsoft/calendars?owner_id=<address-or-id>&is_group=<true|false>`
   — lists that mailbox's calendars (usually just one, "Calendar").
3. `PUT /api/v1/integrations/microsoft/calendar` with:

   ```json
   {
     "calendar_owner_id": "operations@flectere.onmicrosoft.com",
     "calendar_id": "<from step above>",
     "calendar_name": "SNC Operations Calendar",
     "is_group": false,
     "calendar_timezone": "Africa/Harare"
   }
   ```

## Step 9 — Set AEGIS's environment variables

On the backend (DigitalOcean droplet / wherever `imperium-api` runs — see
`deploy/digitalocean/.env.example`), set:

```bash
MICROSOFT_GRAPH_TENANT_ID=<Directory (tenant) ID from Step 3>
MICROSOFT_GRAPH_CLIENT_ID=<Application (client) ID from Step 3>
MICROSOFT_GRAPH_CLIENT_SECRET=<client secret VALUE from Step 4>
```

Then restart the backend process (this project's `uvicorn --reload` does
**not** reliably pick up `.env` changes on this stack — kill and restart it
manually rather than trusting the reload).

## Step 10 — Test the connection

As a signed-in AEGIS user with the `integrations.microsoft.manage`
permission (granted by default to any role that already holds
`settings.update` — see `migrations/219_microsoft_graph_integration_foundation.sql`):

```
POST /api/v1/integrations/microsoft/test-connection
```

A `200` response with `"connection_status": "connected"` means the
credentials, tenant and (once connected) site are all valid. Then run:

```
POST /api/v1/integrations/microsoft/permission-test
```

which separately confirms a real SharePoint read and a real calendar read
both succeed — i.e. `Sites.Selected` was actually granted on the right site
(Step 5's Graph Explorer call) and `Calendars.ReadWrite` was actually
consented (Step 5's portal click), not just that authentication works.

Finally, enable sync once you're ready:

```
PATCH /api/v1/integrations/microsoft/settings
{ "sync_documents": true, "sync_calendar": true }
```

---

## What you should have collected by the end of this guide

| Value | Where it goes |
|---|---|
| Directory (tenant) ID | `MICROSOFT_GRAPH_TENANT_ID` env var |
| Application (client) ID | `MICROSOFT_GRAPH_CLIENT_ID` env var |
| Client secret value | `MICROSOFT_GRAPH_CLIENT_SECRET` env var |
| SNC site ID | via setup wizard `/connect`, stored in the database (not an env var) |
| Document library IDs | via setup wizard `/library-map`, stored in the database |
| Calendar owner + calendar ID | via setup wizard `/calendar`, stored in the database |

No value in this table is a secret except the client secret — everything
else is a non-sensitive identifier, which is why only the client secret
needs to live in an env var rather than the database (see
`docs/microsoft365-phase1/README.md`'s security model section).
