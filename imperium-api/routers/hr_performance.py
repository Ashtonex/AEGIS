"""Weekly performance scorecards. Mounted at /api/v1/hr/performance.

Scoring: app/services/hr/performance.py. Who sees what:
  - hr.performance.read     every scorecard
  - hr.performance.manage   settings, recompute/backfill, overrides, disputes,
                            assisted working decisions
  - a line manager          their direct reports' scorecards; override them
                            (reason required) and keep assisted working notes
  - everyone                their own scorecards; dispute one within 48h
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.hr import performance as perf
from app.services.hr import performance_delivery as delivery
from app.services.hr import time_tracking as tt
from app.shared.events import emit_notification, emit_role_notification
from app.shared.pagination import ok
from core.database import get_db
from core.security import get_current_user, require_permission, user_has_permission

router = APIRouter()
HR_ROLES = ["HR Manager", "HR Officer", "Executive (Admin)"]


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    par_score: Optional[float] = Field(default=None, ge=0, le=100)
    mode: Optional[Literal["shadow", "live"]] = None
    live_from: Optional[date] = None
    digest_recipients: Optional[str] = Field(default=None, max_length=2000)


class Override(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    score: Optional[float] = Field(default=None, ge=0, le=100)  # None clears the override
    reason: str = Field(min_length=10, max_length=2000)


class Dispute(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    note: str = Field(min_length=10, max_length=2000)


class DisputeDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision: Literal["upheld", "rejected"]
    resolution: str = Field(min_length=5, max_length=2000)
    score: Optional[float] = Field(default=None, ge=0, le=100)


class PeriodUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    targets: Optional[str] = Field(default=None, max_length=2000)
    supervisor_notes: Optional[str] = Field(default=None, max_length=5000)
    status: Optional[Literal["passed", "escalated", "cancelled"]] = None
    outcome_note: Optional[str] = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------
async def _my_employee_id(db: AsyncSession, user: dict) -> Optional[str]:
    me = await tt.own_employee(db, user)
    return str(me["id"]) if me else None


async def _access(db: AsyncSession, user: dict, card: dict) -> str:
    """'manage', 'read', 'manager', 'self' - or 403."""
    if await user_has_permission(db, user, "hr.performance.manage"):
        return "manage"
    if await user_has_permission(db, user, "hr.performance.read"):
        return "read"
    if card.get("manager_user_id") and str(card["manager_user_id"]) == str(user["user_id"]):
        return "manager"
    if card.get("user_id") and str(card["user_id"]) == str(user["user_id"]):
        return "self"
    raise HTTPException(403, "You can't see this scorecard.")


async def _card(db: AsyncSession, user: dict, card_id: UUID) -> tuple[dict, str]:
    cards = await delivery.load_cards(db, user["org_id"], card_id=str(card_id))
    if not cards:
        raise HTTPException(404, "Scorecard not found.")
    return cards[0], await _access(db, user, cards[0])


def _public(card: dict, trend: Optional[list] = None) -> dict:
    out = {k: v for k, v in card.items() if k not in ("email", "manager_email")}
    out["final_score"] = perf.final_score(card)
    out["final_grade"] = perf.grade_for(out["final_score"])
    out["standing_label"] = perf.STANDING_LABELS.get(card["standing"], card["standing"])
    if trend is not None:
        out["trend"] = trend
    return out


def _thursday(value: date) -> date:
    if value.weekday() != perf.WEEK_END_WEEKDAY:
        raise HTTPException(422, "A scoring week ends on a Thursday.")
    return value


# ---------------------------------------------------------------------------
# Settings and weeks
# ---------------------------------------------------------------------------
@router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    settings = await perf.get_settings(db, user["org_id"])
    await db.commit()
    can_manage = await user_has_permission(db, user, "hr.performance.manage")
    return ok({**settings, "can_manage": can_manage,
               "can_read_all": can_manage or await user_has_permission(db, user, "hr.performance.read"),
               "default_digest_recipients": delivery.digest_recipients({"digest_recipients": ""}),
               "weights": perf.WEIGHTS, "labels": perf.LABELS, "targets": perf.TARGETS,
               "latest_complete_week_end": perf.scoring_week(datetime.now(timezone.utc))[1].isoformat()}, "Performance settings.")


@router.put("/settings")
async def update_settings(payload: SettingsUpdate, user: dict = Depends(require_permission("hr.performance.manage")),
                          db: AsyncSession = Depends(get_db)):
    await perf.get_settings(db, user["org_id"])
    fields = payload.model_dump(exclude_unset=True)
    if fields.get("live_from") and fields["live_from"].weekday() != perf.WEEK_END_WEEKDAY:
        raise HTTPException(422, "Go-live must be a week ending on a Thursday.")
    if fields:
        sets = ", ".join(f"{k} = :{k}" for k in fields)
        await db.execute(text(f"UPDATE hr.performance_settings SET {sets}, updated_by = :uid, updated_at = NOW() WHERE organization_id = :org"),
                         {**fields, "uid": user["user_id"], "org": user["org_id"]})
    await db.commit()
    return ok(await perf.get_settings(db, user["org_id"]), "Settings saved.")


@router.get("/weeks")
async def weeks(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("""
        SELECT week_end, MIN(mode) AS mode, COUNT(*) AS people, COUNT(emailed_at) AS emailed,
               ROUND(AVG(COALESCE(override_score, score)), 1) AS average,
               COUNT(*) FILTER (WHERE COALESCE(override_score, score) IS NULL) AS not_graded
        FROM hr.weekly_scorecards WHERE organization_id = :org GROUP BY week_end ORDER BY week_end DESC LIMIT 26
    """), {"org": user["org_id"]})
    return ok([dict(r) for r in rows.mappings()], "Scored weeks.")


@router.post("/weeks/{week_end}/compute")
async def compute(week_end: date, user: dict = Depends(require_permission("hr.performance.manage")),
                  db: AsyncSession = Depends(get_db)):
    """Computes (or recomputes) a past week - how shadow mode is backfilled."""
    _thursday(week_end)
    if week_end > perf.scoring_week(datetime.now(timezone.utc))[1]:
        raise HTTPException(422, "That week hasn't finished yet.")
    try:
        summary = await perf.compute_week(db, user["org_id"], week_end)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    await db.commit()
    return ok(summary, f"Scored {summary['people']} people for the week ending {week_end:%d %b}.")


@router.post("/weeks/{week_end}/send-digest")
async def send_digest(week_end: date, user: dict = Depends(require_permission("hr.performance.manage")),
                      db: AsyncSession = Depends(get_db)):
    result = await delivery.send_digest(db, user["org_id"], _thursday(week_end))
    if not result["sent"]:
        raise HTTPException(502, "The digest could not be sent.")
    return ok(result, f"Digest sent to {', '.join(result['sent'])}.")


# ---------------------------------------------------------------------------
# Scorecards
# ---------------------------------------------------------------------------
@router.get("/scorecards")
async def scorecards(week_end: Optional[date] = Query(default=None), user: dict = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    """Everyone for HR; a line manager's direct reports otherwise."""
    org = user["org_id"]
    if not week_end:
        week_end = (await db.execute(text("SELECT MAX(week_end) FROM hr.weekly_scorecards WHERE organization_id = :org"),
                                     {"org": org})).scalar()
        if not week_end:
            return ok({"week_end": None, "cards": []}, "No weeks scored yet.")
    cards = await delivery.load_cards(db, org, week_end=week_end)
    all_access = (await user_has_permission(db, user, "hr.performance.read")
                  or await user_has_permission(db, user, "hr.performance.manage"))
    if not all_access:
        cards = [c for c in cards if c.get("manager_user_id") and str(c["manager_user_id"]) == str(user["user_id"])]
    trend = await delivery.trends(db, org, [str(c["employee_id"]) for c in cards], week_end) if cards else {}
    return ok({"week_end": week_end.isoformat(), "scope": "all" if all_access else "team",
               "cards": [_public(c, trend.get(str(c["employee_id"]), [])) for c in cards]}, "Scorecards.")


@router.get("/me")
async def my_scorecards(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    employee_id = await _my_employee_id(db, user)
    if not employee_id:
        return ok({"linked": False, "cards": []}, "Your login is not linked to a person record.")
    settings = await perf.get_settings(db, user["org_id"])
    await db.commit()
    cards = await delivery.load_cards(db, user["org_id"], employee_id=employee_id)
    if settings["mode"] != "live":  # staff see nothing while scorecards are in shadow mode
        cards = [c for c in cards if c["mode"] == "live"]
    return ok({"linked": True, "par_score": settings["par_score"], "cards": [_public(c) for c in cards[:26]]}, "Your scorecards.")


@router.get("/scorecards/{card_id}")
async def scorecard(card_id: UUID, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    card, access = await _card(db, user, card_id)
    if access == "self" and card["mode"] != "live":
        raise HTTPException(404, "Scorecard not found.")
    trend = (await delivery.trends(db, user["org_id"], [str(card["employee_id"])], card["week_end"], weeks=8)).get(str(card["employee_id"]), [])
    period = await delivery.period_for(db, card)
    return ok({**_public(card, trend), "access": access, "assisted_period": period}, "Scorecard.")


@router.get("/scorecards/{card_id}/email")
async def scorecard_email(card_id: UUID, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The employee's email exactly as it is (or would be) sent."""
    card, access = await _card(db, user, card_id)
    if access == "self" and card["mode"] != "live":
        raise HTTPException(404, "Scorecard not found.")
    settings = await perf.get_settings(db, user["org_id"])
    await db.commit()
    subject, html, _ = await delivery.employee_email(db, user["org_id"], card, settings["par_score"])
    return ok({"subject": subject, "html": html, "to": card.get("email")}, "Email preview.")


async def _apply_final(db: AsyncSession, org_id: str, card: dict, *, score: Optional[float], reason: Optional[str], by: str) -> dict:
    """Stores an override and moves the standing if it should move."""
    await db.execute(text("""
        UPDATE hr.weekly_scorecards SET override_score = :score, override_reason = :reason,
            override_by = :by, override_at = NOW() WHERE id = :id
    """), {"score": score, "reason": reason if score is not None else None, "by": by, "id": card["id"]})
    settings = await perf.get_settings(db, org_id)
    updated = {**card, "override_score": score}
    standing = perf.standing_after_override(updated, settings["par_score"])
    if standing and standing != card["standing"]:
        if card["standing"] == "assisted_opened" and card.get("assisted_period_id"):
            await db.execute(text("""UPDATE hr.assisted_working_periods SET status = 'cancelled', outcome_note = :note,
                decided_by = :by, decided_at = NOW(), updated_at = NOW() WHERE id = :id AND status = 'active'"""),
                {"note": "Cancelled: the score that opened it was overridden to par or above.", "by": by, "id": card["assisted_period_id"]})
        await db.execute(text("UPDATE hr.weekly_scorecards SET standing = :s WHERE id = :id"), {"s": standing, "id": card["id"]})
    return updated


@router.post("/scorecards/{card_id}/override")
async def override(card_id: UUID, payload: Override, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    card, access = await _card(db, user, card_id)
    if access not in ("manage", "manager"):
        raise HTTPException(403, "Only HR management or the person's line manager can override a score.")
    await _apply_final(db, user["org_id"], card, score=payload.score, reason=payload.reason, by=user["user_id"])
    if access == "manager":
        await emit_role_notification(db, org_id=user["org_id"], role_names=HR_ROLES,
                                     title=f"Score overridden: {card['employee_name']}",
                                     message=f"Week ending {card['week_end']:%d %b}: {perf.final_score(card)} -> {payload.score}. {payload.reason}",
                                     notification_type="hr_performance", action_url="/dashboard/hr/performance")
    await db.commit()
    return ok({"id": str(card_id)}, "Score overridden." if payload.score is not None else "Override cleared.")


@router.post("/scorecards/{card_id}/dispute")
async def dispute(card_id: UUID, payload: Dispute, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    card, access = await _card(db, user, card_id)
    if access != "self" and str(card.get("user_id")) != str(user["user_id"]):
        raise HTTPException(403, "Only the person scored can dispute a scorecard.")
    if card["mode"] != "live" or not card["emailed_at"]:
        raise HTTPException(409, "This scorecard hasn't been issued to you.")
    if datetime.now(timezone.utc) - card["emailed_at"] > timedelta(hours=perf.DISPUTE_HOURS):
        raise HTTPException(409, f"The {perf.DISPUTE_HOURS}-hour window to dispute this week has closed.")
    if card["dispute_status"]:
        raise HTTPException(409, "You have already disputed this week.")
    await db.execute(text("""UPDATE hr.weekly_scorecards SET dispute_note = :note, disputed_at = NOW(), dispute_status = 'open'
        WHERE id = :id"""), {"note": payload.note, "id": card["id"]})
    title = f"Scorecard disputed: {card['employee_name']}"
    message = f"Week ending {card['week_end']:%d %b}: {payload.note[:300]}"
    if card.get("manager_user_id"):
        await emit_notification(db, org_id=user["org_id"], user_id=str(card["manager_user_id"]), title=title, message=message,
                                notification_type="hr_performance", action_url="/dashboard/hr/performance")
    await emit_role_notification(db, org_id=user["org_id"], role_names=HR_ROLES, title=title, message=message,
                                 notification_type="hr_performance", action_url="/dashboard/hr/performance")
    await db.commit()
    return ok({"id": str(card_id)}, "Dispute sent to HR and your line manager.")


@router.post("/scorecards/{card_id}/dispute/resolve")
async def resolve_dispute(card_id: UUID, payload: DisputeDecision, user: dict = Depends(require_permission("hr.performance.manage")),
                          db: AsyncSession = Depends(get_db)):
    card, _ = await _card(db, user, card_id)
    if card["dispute_status"] != "open":
        raise HTTPException(409, "There is no open dispute on this scorecard.")
    if payload.decision == "upheld" and payload.score is not None:
        await _apply_final(db, user["org_id"], card, score=payload.score, reason=f"Dispute upheld: {payload.resolution}", by=user["user_id"])
    await db.execute(text("""UPDATE hr.weekly_scorecards SET dispute_status = :d, dispute_resolution = :r,
        dispute_resolved_by = :by, dispute_resolved_at = NOW() WHERE id = :id"""),
        {"d": payload.decision, "r": payload.resolution, "by": user["user_id"], "id": card["id"]})
    if card.get("user_id"):
        await emit_notification(db, org_id=user["org_id"], user_id=str(card["user_id"]),
                                title=f"Your dispute was {payload.decision}", message=payload.resolution,
                                notification_type="hr_performance", action_url="/dashboard/workforce/my-performance")
    await db.commit()
    return ok({"id": str(card_id)}, f"Dispute {payload.decision}.")


# ---------------------------------------------------------------------------
# Assisted working periods
# ---------------------------------------------------------------------------
@router.get("/assisted")
async def assisted(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    all_access = (await user_has_permission(db, user, "hr.performance.read")
                  or await user_has_permission(db, user, "hr.performance.manage"))
    rows = await db.execute(text("""
        SELECT a.*, e.employee_name, e.job_title, s.employee_name AS supervisor_name, s.linked_user_id AS supervisor_user_id
        FROM hr.assisted_working_periods a
        JOIN hr.employees e ON e.id = a.employee_id
        LEFT JOIN hr.employees s ON s.id = a.supervisor_employee_id
        WHERE a.organization_id = :org AND (CAST(:all AS boolean) OR s.linked_user_id = :uid)
        ORDER BY (a.status IN ('active', 'escalated')) DESC, a.opened_week_end DESC
        LIMIT 100
    """), {"org": user["org_id"], "all": all_access, "uid": user["user_id"]})
    return ok([dict(r) for r in rows.mappings()], "Assisted working periods.")


@router.patch("/assisted/{period_id}")
async def update_period(period_id: UUID, payload: PeriodUpdate, user: dict = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text("""
        SELECT a.*, s.linked_user_id AS supervisor_user_id FROM hr.assisted_working_periods a
        LEFT JOIN hr.employees s ON s.id = a.supervisor_employee_id
        WHERE a.id = :id AND a.organization_id = :org
    """), {"id": period_id, "org": user["org_id"]})).mappings().first()
    if not row:
        raise HTTPException(404, "Assisted working period not found.")
    manage = await user_has_permission(db, user, "hr.performance.manage")
    supervisor = row["supervisor_user_id"] and str(row["supervisor_user_id"]) == str(user["user_id"])
    if not (manage or supervisor):
        raise HTTPException(403, "Only HR management or the supervising line manager can update this.")
    fields = payload.model_dump(exclude_unset=True)
    if "status" in fields and not manage:
        raise HTTPException(403, "Only HR management can close an assisted working period.")
    if not fields:
        return ok({"id": str(period_id)}, "Nothing to change.")
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    extra = ", decided_by = :uid, decided_at = NOW()" if "status" in fields else ""
    await db.execute(text(f"UPDATE hr.assisted_working_periods SET {sets}{extra}, updated_at = NOW() WHERE id = :id"),
                     {**fields, "uid": user["user_id"], "id": period_id})
    await db.commit()
    return ok({"id": str(period_id)}, "Saved.")
