# Scheduled automation checks

`run_stale_quote_check.py`, `run_weekly_digest.py`, and `run_activity_reminders.py` are not run through
the arq worker (`app/workers/arq_worker.py`) - that worker process has
never actually been deployed (no `worker` service in
`deploy/digitalocean/docker-compose.yml`, `BACKGROUND_JOBS_ENABLED=false`),
and `core/config.py` deliberately refuses to enable background jobs against
the local docker-compose Redis container in production (it requires a
managed Redis, since the local container's queue isn't durable across
redeploys). Standing that up is a real infra decision, not something to
route around silently.

Until that's in place, these two checks run instead via the droplet's own
system cron, calling the backend container directly:

```
# /etc/cron.d/aegis-automation (as root)
0 8 * * *   root  cd /opt/aegis/deploy/digitalocean && docker compose exec -T imperium-api python3 scripts/run_stale_quote_check.py >> /var/log/aegis-cron.log 2>&1
0 6 * * 1   root  cd /opt/aegis/deploy/digitalocean && docker compose exec -T imperium-api python3 scripts/run_weekly_digest.py >> /var/log/aegis-cron.log 2>&1
*/15 * * * * root  cd /opt/aegis/deploy/digitalocean && docker compose exec -T imperium-api python3 scripts/run_activity_reminders.py >> /var/log/aegis-cron.log 2>&1
0 7 * * *   root  cd /opt/aegis/deploy/digitalocean && docker compose exec -T imperium-api python3 scripts/run_hr_workforce_alerts.py >> /var/log/aegis-cron.log 2>&1
0 7 * * *   root  cd /opt/aegis/deploy/digitalocean && docker compose exec -T imperium-api python3 scripts/run_compliance_alerts.py >> /var/log/aegis-cron.log 2>&1
0 * * * *   root  cd /opt/aegis/deploy/digitalocean && docker compose exec -T imperium-api python3 scripts/run_hse_escalation.py >> /var/log/aegis-cron.log 2>&1
```

`run_hr_workforce_alerts.py`, `run_compliance_alerts.py`, and `run_hse_escalation.py`
follow the same direct-`emit_notification`/`emit_role_notification` pattern
as `run_activity_reminders.py` (see below), for the same reason: an
expiring certification, an overdue corrective action, or an unresolved
safety incident needs to reach the relevant role unconditionally, not
depend on an org having configured a matching automation rule. Each script
dedups against `core.notifications.metadata->>'source_id'` so a daily (or
hourly, for HSE) cron run doesn't re-notify about the same item every time
it fires - see each script's `DEDUP_HOURS`/`_already_alerted` for the
window.

(06:00 UTC Monday = 08:00 CAT, the org's local timezone.)

`run_stale_quote_check.py` and `run_weekly_digest.py` fire a named
automation trigger (`quotation_stale`, `weekly_digest`) through the same
`crm.automation_rules` engine used everywhere else in the CRM - so what
actually happens (email, in-app notification, etc.) is configured via
automation rules, not hardcoded in the scripts themselves.

`run_activity_reminders.py` is the one exception: it calls
`emit_notification()` directly instead of going through an automation rule,
because a reminder needs to reach the activity's owner unconditionally -
it can't depend on the org having configured a matching automation rule
first. It runs every 15 minutes and reminds about anything due in the next
hour, using `crm.activities.reminder_sent_at` to avoid double-sending.
