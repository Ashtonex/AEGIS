"""What happens when a tender enters AEGIS, and the scheduled e-GP run.

  on_tender_entered()      in the creating transaction: start the review
                           workflow and queue the new-tender emails
  after_commit()           afterwards, outside any request: collect the e-GP
                           material (documents, schedule) so the email can
                           carry it, then send the queued emails
  auto_import_run()        import a finished run's matching notices
  run_scheduled()          the cron entry: due orgs -> run -> import ->
                           collect -> email, plus email retries

Entry points that create tenders: e-GP import (manual or automatic,
app/services/tenders/egp/intake.py) and POST /crm/tenders (routers/crm.py).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders import notify, workflow
from app.services.tenders.egp import portal
from core.database import AsyncSessionLocal
from core.logging import logger


async def on_tender_entered(db: AsyncSession, *, org_id: str, tender_id: str, actor: Optional[str], origin: str) -> dict:
    settings = await workflow.get_settings(db, org_id)
    started = None
    if settings["workflow_enabled"]:
        started = await workflow.start_workflow(db, org_id=org_id, tender_id=tender_id, actor=actor, origin=origin)
    queued = await notify.queue_new_tender_email(db, org_id, tender_id)
    return {"workflow": (started or {}).get("status"), "emails_queued": queued}


async def after_commit(org_id: str, tender_ids: Iterable[str], *, post_import_hooks: bool = True) -> None:
    """Background: collect source material, then send the emails. Each
    tender in its own session; a failure is logged and recorded, never
    raised (the emails still go out with what is known).
    post_import_hooks: also the stage task pack and calendar sync a tender
    gets when created by a person (the manual import endpoint already does
    those itself and passes False)."""
    from app.services.tenders.egp.collect import collect_for_tender
    from app.shared.task_stacks import generate_task_stack
    from routers.tender_bids import _sync_tender_calendar

    for tender_id in dict.fromkeys(str(t) for t in tender_ids):
        try:
            async with AsyncSessionLocal() as db:
                settings = await workflow.get_settings(db, org_id)
                await db.commit()
                if settings["collect_documents"]:
                    await collect_for_tender(db, org_id, tender_id)
        except Exception:  # noqa: BLE001 - logged; the tender and its emails are unaffected
            logger.exception("tender_pipeline.collect_failed", tender_id=tender_id)
        try:
            async with AsyncSessionLocal() as db:
                if post_import_hooks:
                    await generate_task_stack(db, org_id=org_id, entity_type="tender", entity_id=tender_id,
                                              created_by=None, source_event="egp_tender_import",
                                              generation_reason="Imported automatically from the PRAZ e-GP portal.")
                    await db.commit()
                # Deadline and any site visit found by the collection.
                await _sync_tender_calendar(db, org_id=org_id, item_id=tender_id, sync_submission=True, sync_visit=True)
        except Exception:  # noqa: BLE001 - the tender is saved; the pack/calendar can be regenerated
            logger.exception("tender_pipeline.post_import_hooks_failed", tender_id=tender_id)
        try:
            async with AsyncSessionLocal() as db:
                await notify.deliver_pending(db, org_id=org_id, tender_id=tender_id)
        except Exception:  # noqa: BLE001 - deliveries stay pending/failed and are retried by the cron
            logger.exception("tender_pipeline.email_failed", tender_id=tender_id)


async def auto_import_run(db: AsyncSession, *, org_id: str, run_id: str) -> list[str]:
    """Imports this run's new notices in the configured relevance bands.
    Returns the ids of tenders created (caller commits, then after_commit)."""
    from app.services.tenders.egp.intake import import_candidates

    settings = await workflow.get_settings(db, org_id)
    if not settings["auto_import_enabled"]:
        return []
    bands = [b for b in settings["auto_import_bands"] or [] if b in ("strong", "possible", "weak")] or ["strong"]
    rows = (await db.execute(
        text("""
            SELECT id FROM crm.tender_candidates
            WHERE organization_id = :org_id AND last_run_id = :run_id AND review_status = 'new'
              AND detail_status = 'fetched' AND relevance_band = ANY(CAST(:bands AS text[]))
              AND (closing_at IS NULL OR closing_at > NOW())
            ORDER BY relevance_score DESC NULLS LAST
            LIMIT 100
        """),
        {"org_id": org_id, "run_id": run_id, "bands": bands},
    )).scalars().all()
    if not rows:
        return []
    results = await import_candidates(db, {"org_id": org_id, "user_id": None},
                                      [{"candidate_id": str(cid)} for cid in rows],
                                      responsible_user_id=None, internal_review_date=None)
    created = [r["tender_id"] for r in results if r.get("created")]
    logger.info("tender_pipeline.auto_import", org_id=org_id, run_id=run_id, candidates=len(rows), created=len(created),
                outcomes={s: sum(1 for r in results if r.get("status") == s) for s in {r.get("status") for r in results}})
    return created


async def run_discovery_and_import(org_id: str, run_id: str) -> dict:
    """A run started from the API or the schedule: run it, import its
    matches, then collect and email for each new tender."""
    from app.services.tenders.egp.discovery import execute_run

    async with AsyncSessionLocal() as db:
        run = await execute_run(db, run_id)
        await db.execute(
            text("""UPDATE crm.tender_sources SET last_run_at = NOW(), last_run_status = :status, updated_at = NOW()
                    WHERE organization_id = :org_id AND source_key = :key"""),
            {"status": (run or {}).get("status"), "org_id": org_id, "key": portal.SOURCE_KEY},
        )
        if (run or {}).get("outcome") == "restricted":
            await db.execute(
                text("""UPDATE crm.tender_sources SET last_auth_problem = :p, last_auth_problem_at = NOW()
                        WHERE organization_id = :org_id AND source_key = :key"""),
                {"p": (run or {}).get("summary") or "The portal refused access or asked for a login/CAPTCHA.",
                 "org_id": org_id, "key": portal.SOURCE_KEY},
            )
        created: list[str] = []
        if (run or {}).get("status") in ("completed", "partial"):
            created = await auto_import_run(db, org_id=org_id, run_id=run_id)
        await db.commit()
    if created:
        await after_commit(org_id, created)
    return {"run_status": (run or {}).get("status"), "outcome": (run or {}).get("outcome"), "tenders_created": len(created)}


async def run_scheduled(now: Optional[datetime] = None) -> list[dict]:
    """Cron entry (scripts/run_tender_automation.py). For every org whose
    schedule is due: verify the connection, run discovery, import, collect
    and email. Then retry due email deliveries for everyone."""
    from app.services.tenders.egp.discovery import (
        ActiveRunExists,
        create_run,
        ensure_default_profile,
        ensure_source,
        mark_stale_runs,
        probe_connection,
    )

    now = now or datetime.now(timezone.utc)
    outcomes: list[dict] = []
    async with AsyncSessionLocal() as db:
        due = (await db.execute(
            text("""
                SELECT organization_id FROM crm.tender_automation_settings
                WHERE schedule_enabled
                  AND (last_scheduled_run_at IS NULL
                       OR last_scheduled_run_at <= CAST(:now AS timestamptz) - make_interval(mins => schedule_interval_minutes))
            """),
            {"now": now},
        )).scalars().all()
    for org_id in [str(o) for o in due]:
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(text("UPDATE crm.tender_automation_settings SET last_scheduled_run_at = :now WHERE organization_id = :org_id"),
                                 {"now": now, "org_id": org_id})
                await mark_stale_runs(db, org_id)
                source = await ensure_source(db, org_id)
                if not source["enabled"]:
                    await db.commit()
                    outcomes.append({"org_id": org_id, "skipped": "source disabled"})
                    continue
                verified_at = source.get("last_verified_at")
                if source["connection_state"] != "connected_verified" or not verified_at or now - verified_at > timedelta(hours=12):
                    await probe_connection(db, org_id=org_id, user_id=None)
                    source = await ensure_source(db, org_id)
                if source["connection_state"] != "connected_verified":
                    await db.execute(
                        text("""UPDATE crm.tender_sources SET last_run_at = NOW(), last_run_status = 'failed',
                                last_auth_problem = :p, last_auth_problem_at = NOW() WHERE organization_id = :org_id AND source_key = :key"""),
                        {"p": source["state_reason"] or source["connection_state"], "org_id": org_id, "key": portal.SOURCE_KEY},
                    )
                    await db.commit()
                    outcomes.append({"org_id": org_id, "failed": source["connection_state"]})
                    continue
                profile = await ensure_default_profile(db, org_id, None)
                try:
                    run = await create_run(db, org_id=org_id, user_id=None, profile=profile,
                                           filters=dict(profile.get("default_filters") or {}), page_limit=None)
                except ActiveRunExists:
                    await db.commit()
                    outcomes.append({"org_id": org_id, "skipped": "a run is already active"})
                    continue
                await db.execute(text("UPDATE crm.tender_discovery_runs SET executor = 'schedule' WHERE id = :id"), {"id": run["id"]})
                await db.commit()
            outcomes.append({"org_id": org_id, **await run_discovery_and_import(org_id, str(run["id"]))})
        except Exception as exc:  # noqa: BLE001 - one org's failure never stops the others
            logger.exception("tender_pipeline.scheduled_failed", org_id=org_id)
            outcomes.append({"org_id": org_id, "error": type(exc).__name__})
    async with AsyncSessionLocal() as db:
        outcomes.append({"email_retries": await notify.deliver_pending(db, limit=200)})
    return outcomes
