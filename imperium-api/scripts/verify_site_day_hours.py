"""Verifies site-day hours -> daily report labour on the configured database
inside a transaction that is always rolled back, with push/email stubbed.

    .venv/Scripts/python.exe scripts/verify_site_day_hours.py

  1. re-syncing every report linked to a site day makes its labour hours
     equal the register's recorded hours (was: 8 h default per worker)
  2. closing a started day on a later date without a leaving time -> 422
  3. closing it with the leaving time books hours up to that time, no
     overnight overtime; the linked report equals the register
  4. an individual late clock-out without a time -> 422
"""

import asyncio
from datetime import datetime, time

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE
from routers.site_day import HARARE, ClockOut, clock_out_attendance, close_site_day, sync_attendance_to_daily_report


async def register_vs_report(db, briefing_id, report_id):
    reg = (await db.execute(text("""
        SELECT COALESCE(SUM(regular_hours), 0) r, COALESCE(SUM(overtime_hours), 0) o FROM projects.site_day_attendance WHERE briefing_id = :b
    """), {"b": briefing_id})).first()
    rep = (await db.execute(text("""
        SELECT COALESCE(SUM(regular_hours), 0) r, COALESCE(SUM(overtime_hours), 0) o FROM projects.daily_report_labour
        WHERE report_id = :r AND NOT COALESCE(is_deleted, false) AND attendance_id IS NOT NULL
    """), {"r": report_id})).first()
    return reg, rep


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            pairs = (await db.execute(text("""
                SELECT r.id AS report_id, r.briefing_id, r.report_date, r.status, r.organization_id::text AS org_id
                FROM projects.daily_site_reports r
                WHERE r.briefing_id IS NOT NULL AND NOT r.is_deleted ORDER BY r.report_date DESC
            """))).all()
            print(f"\n== 1. re-sync {len(pairs)} site-day reports")
            for p in pairs:
                _, before = await register_vs_report(db, p.briefing_id, p.report_id)
                await sync_attendance_to_daily_report(db, org_id=p.org_id, briefing_id=p.briefing_id, report_id=p.report_id)
                reg, rep = await register_vs_report(db, p.briefing_id, p.report_id)
                if p.status in ("draft", "rejected"):
                    check(reg.r == rep.r and reg.o == rep.o,
                          f"{p.report_date} {p.status}: report {before.r}+{before.o} -> {rep.r}+{rep.o} h = register {reg.r}+{reg.o} h")
                else:
                    check((rep.r, rep.o) == (before.r, before.o),
                          f"{p.report_date} {p.status}: signed report left as is ({rep.r}+{rep.o} h; register {reg.r}+{reg.o} h)")

            day = (await db.execute(text("""
                SELECT b.id, b.briefing_date, b.started_at, b.organization_id::text AS org_id,
                       (SELECT id FROM projects.daily_site_reports r WHERE r.briefing_id = b.id AND NOT r.is_deleted LIMIT 1) AS report_id
                FROM projects.site_day_briefings b
                WHERE b.status = 'started' AND b.shift = 'day' AND NOT b.is_deleted
                  AND b.briefing_date < (now() AT TIME ZONE 'Africa/Harare')::date
                ORDER BY b.briefing_date DESC LIMIT 1
            """))).first()
            if not day:
                check(False, "a started day shift from an earlier date exists to test with")
                return finish()
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": day.org_id})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": day.org_id, "role": SUPERADMIN_ROLE}

            att = (await db.execute(text("""
                SELECT id FROM projects.site_day_attendance WHERE briefing_id = :b AND clock_in_at IS NOT NULL AND clock_out_at IS NULL LIMIT 1
            """), {"b": day.id})).scalar()
            print(f"\n== 4. late individual clock-out on {day.briefing_date}")
            try:
                await clock_out_attendance(att, None, user=user, db=db)
                check(False, "late clock-out without a time refused")
            except HTTPException as exc:
                check(exc.status_code == 422, f"late clock-out without a time refused ({exc.detail[:70]}...)")

            print(f"\n== 2./3. close {day.briefing_date} day started {day.started_at:%Y-%m-%d %H:%M} UTC")
            try:
                await close_site_day(day.id, None, user=user, db=db)
                check(False, "late close without a leaving time refused")
            except HTTPException as exc:
                check(exc.status_code == 422, "late close without a leaving time refused")
            left = datetime.combine(day.briefing_date, time(16, 30), tzinfo=HARARE)
            await close_site_day(day.id, ClockOut(left_site_at=left), user=user, db=db)
            rows = (await db.execute(text("""
                SELECT clock_out_at, regular_hours, overtime_hours FROM projects.site_day_attendance WHERE briefing_id = :b AND clock_in_at IS NOT NULL
            """), {"b": day.id})).all()
            check(all(r.clock_out_at == left for r in rows), f"{len(rows)} people clocked out at 16:30 local, not now")
            check(all(r.overtime_hours == 0 for r in rows), "no overnight overtime booked")
            check(all(0 < r.regular_hours <= 9 for r in rows), f"regular hours per person {sorted({float(r.regular_hours) for r in rows})}")
            if day.report_id:
                reg, rep = await register_vs_report(db, day.id, day.report_id)
                check(reg.r == rep.r and reg.o == rep.o, f"linked report {rep.r}+{rep.o} h = register {reg.r}+{reg.o} h")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
