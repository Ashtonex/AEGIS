# Move the AEGIS backend to London (LON1)

Drafted 3 October 2026.

## Why

| Piece | Where it is today | Evidence |
|---|---|---|
| Backend droplet (`api.sixnineconstruction.com`, 142.93.112.27) | New York (DigitalOcean NYC, North Bergen NJ) | IP geolocation |
| Managed Valkey/Redis `aegis-jobs-redis` | NYC1 | deploy notes |
| Vercel functions (the `/api/v1/*` proxy every browser call goes through) | `iad1`, Washington DC | `x-vercel-id: cpt1::iad1::…` on a live request |
| Supabase database | `eu-west-1`, Dublin | `DATABASE_URL` pooler host |
| Users | Harare (edge: Cape Town, `cpt1`) | |

Every database query crosses the Atlantic, at roughly 70–80 ms each. A dashboard request that runs 10–15 queries spends about 1 s on that alone.

After the move, everything sits within about 10 ms of everything else (London ↔ Dublin). Users in Harare pay one long-haul trip per request, and nothing extra per query.

**The Vercel function region has to move in the same window.** If only the droplet moves, the Atlantic crossing moves from API↔database to Vercel↔API. That's once per request instead of once per query, so it's still better, but much of the gain is lost.

## Approach

Snapshot the current droplet, copy the snapshot to LON1 and boot a new droplet from it. The `.env`, the git checkout, the Caddy TLS certificate and the deploy SSH key all come across unchanged.

Both droplets run side by side, and the switch is a DNS change. The old droplet stays untouched as the rollback for 48 h.

DigitalOcean Reserved IPs are tied to one region, so the IP **will** change. Cloudflare DNS for `api.` is DNS-only (grey cloud), so changing the A record is all it takes.

## Steps

**Who:** **[You]** means DigitalOcean, Cloudflare or Vercel dashboard work. Claude has no DigitalOcean access, and the Vercel connector can't reach the `flectere` team. **[Claude]** means repo, GitHub or SSH work done through a one-off `workflow_dispatch` job, never the DigitalOcean web console.

### Day before (10 min)
1. **[You]** In Cloudflare, set the TTL on the `api` A record to 1 min so the switch spreads fast.
2. **[You]** In Supabase, check Settings → Database → Network Restrictions. If 142.93.112.27 is on an allow-list, add the new IP once you have it (step 6).
3. **[You]** In Vercel, check that `INTERNAL_API_URL` / `NEXT_PUBLIC_API_URL` are `https://api.sixnineconstruction.com` and not a raw IP. If they're the hostname, they don't need to change.
4. **Agree a freeze:** no pushes touching `imperium-api/**` or `deploy/**` during the window. The other working session commits to this repo too. A push mid-move would deploy to whichever host `DROPLET_HOST` points at.

### Prepare (about 45–60 min, mostly waiting)
5. **[You]** Create a new managed Valkey in **LON1** (same size as `aegis-jobs-redis`). Put it in the LON1 VPC. Under Trusted Sources, add the new droplet once it exists.
6. **[You]** Take a live snapshot of the NYC droplet without powering it off. Use Snapshot → "Add to region" → London. Create a droplet from it in **LON1**, at the same size or one size up, with the same SSH keys. Note the new IP.
7. **[Claude]** As soon as the new droplet boots, stop its worker, so two workers never run the same scheduled jobs at once: `docker compose stop imperium-worker`.
8. **[Claude]** On the new droplet, change `REDIS_URL` in `/opt/aegis/deploy/digitalocean/.env` to the LON1 Valkey's private address. Then restart only `imperium-api` and `caddy`.

### Check before switching (15 min)
9. **[Claude]** Hit the new box directly while DNS still points to New York:
   `curl --resolve api.sixnineconstruction.com:443:<NEW_IP> https://api.sixnineconstruction.com/health`
   Also call one authenticated read endpoint the same way, and compare the timing against the NYC box.
10. **[Claude]** From the new droplet, time one database query, which should be about 10 ms, and check the Redis connection.

### Switch over (about 15–20 min)
11. **[Claude]** Look at the old Redis queue (`arq:queue`). Wait until it's empty or only holds recurring scheduled jobs.
12. **[Claude]** Stop the **old** droplet's worker.
13. **[You]** In Cloudflare, change the `api` A record to the new IP.
14. **[Claude]** Start the **new** droplet's worker. There's about a 5-minute gap with no worker, so scheduled jobs skip that window (see below).
15. **[You]** In Vercel, go to Project → Settings → Functions → Function Region and change it to **Dublin (`dub1`)**, or London (`lhr1`). Then redeploy production.
16. **[Claude]** Update the GitHub secret `DROPLET_HOST` to the new IP. Run `deploy-backend.yml` once by hand to prove the pipeline reaches the new box.
17. **[Claude]** Check that `x-vercel-id` now shows `::dub1::`. Then do a login → executive → finance walk-through and compare timings.

### Afterwards
18. Keep the NYC droplet and NYC Valkey **stopped but not destroyed** for 48 h.
19. **[You]** Destroy the NYC droplet, the NYC Valkey and the snapshot. Set the Cloudflare TTL back to Auto.
20. **[Claude]** Update the deploy notes (`deploy/digitalocean/README.md` and memory) with the region and the new IP.

## Total time

- **Hands-on:** about 2–3 hours in one sitting, about half of it waiting on the snapshot copy.
- **Users:** effectively no downtime. Both backends serve the same database while DNS spreads, so either one answers correctly.
- **Pick a quiet window:** for example Sunday 18:00–21:00 Harare. Avoid the times listed below.

## What gets affected

| Area | Effect | Handling |
|---|---|---|
| **Speed** | Faster. Fewer cross-ocean trips per page. Biggest on Executive, Finance and Project detail. | Run the before/after timings in step 17. |
| **Users mid-session** | No logout. An upload or save that's in flight during the DNS switch could fail once. The realtime WebSocket reconnects by itself. | Quiet window. Tell staff "retry if a save fails between 19:00 and 19:15". |
| **Scheduled jobs** (arq worker) | About a 5-minute window with no worker. Jobs due in that gap are skipped, not run twice. The bank workbook sync runs every 2 min and catches up. | Don't switch near 02:30 (bank workbook publish), 03:00, 04:00, 06:00, or :05 past the hour on a Friday (weekly HR report). |
| **Queued jobs** | Anything still sitting in the NYC Redis queue is lost. | Step 11 drains it first. |
| **Login cache / Redis cache** | Starts empty. Each user's first request after the switch re-checks their token with Supabase, so it's slightly slower once. | None needed. |
| **Database connections** | Both droplets are connected during the overlap: about 40 on the 6543 transaction pooler instead of 20. | Within limits. The 15-connection cap only applies to the 5432 session pooler, which the app doesn't use. |
| **GitHub auto-deploy** | Keeps going to the old box until `DROPLET_HOST` changes. | Step 16, plus the freeze in step 4. |
| **Inbound webhooks** (Resend, CRM integrations, Teams/Power Automate) | No change, because they use the hostname. | None needed. |
| **Outbound IP** (the backend's address as seen by other services) | Changes to the new IP. Only matters if something allow-lists 142.93.112.27. | Step 2 (Supabase). Microsoft Graph and Resend don't allow-list by IP. |
| **Microsoft 365, Teams notifications, SharePoint sync** | No change. Same credentials in the copied `.env`. | Spot-check with `/integrations/microsoft/test-connection` after the switch. |
| **Cost** | About the same each month. Two droplets and two Valkeys for 48 h: a few dollars. | |

## Rollback

1. Point the Cloudflare `api` record back to 142.93.112.27.
2. Stop the LON1 worker, then start the NYC worker.
3. Set `DROPLET_HOST` back to the old IP, and the Vercel function region back to `iad1`.

The NYC box is never changed, so this takes about 5 minutes.
