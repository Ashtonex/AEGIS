"""Keep the accounting calendar ahead of the date.

Accounting periods were seeded once (migration 181: the month of the migration
and the two after it) and from then on only created by hand. When nobody
created the next month, every posting dated in it was refused with "No
accounting period covers ...". This opens the current month and the months
after it for every organisation that keeps books, so the calendar never runs
out.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger

# The current month plus this many months after it.
MONTHS_AHEAD = 2

# Month boundaries follow the business day, not UTC: at 23:00 UTC on the last
# day of a month it is already the 1st in Harare.
LOCAL_TIMEZONE = "Africa/Harare"


async def ensure_upcoming_periods(db: AsyncSession, *, months_ahead: int = MONTHS_AHEAD) -> list[dict]:
    """Open any missing calendar-month period from this month to
    `months_ahead` months out. Returns the periods it created.

    Only organisations that already have a period get new ones, and a month
    is skipped when any existing period overlaps it, so a hand-made period
    with unusual dates is never doubled up. Existing periods are not touched:
    a closed month stays closed.
    """
    rows = (await db.execute(
        text("""
            INSERT INTO finance.accounting_periods
                (organization_id, period_code, fiscal_year, period_number, period_start, period_end, status)
            SELECT
                o.id,
                to_char(m.period_start, 'YYYY-MM'),
                EXTRACT(YEAR FROM m.period_start)::INT,
                EXTRACT(MONTH FROM m.period_start)::INT,
                m.period_start,
                (m.period_start + INTERVAL '1 month - 1 day')::DATE,
                'open'
            FROM core.organizations o
            CROSS JOIN LATERAL (
                SELECT (date_trunc('month', NOW() AT TIME ZONE :tz) + make_interval(months => n))::DATE AS period_start
                FROM generate_series(0, CAST(:months_ahead AS INT)) AS n
            ) AS m
            WHERE o.is_deleted = false
              AND EXISTS (
                  SELECT 1 FROM finance.accounting_periods have
                  WHERE have.organization_id = o.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM finance.accounting_periods p
                  WHERE p.organization_id = o.id
                    AND p.period_start <= (m.period_start + INTERVAL '1 month - 1 day')::DATE
                    AND p.period_end >= m.period_start
              )
            ON CONFLICT (organization_id, period_code) DO NOTHING
            RETURNING organization_id, period_code
        """),
        {"tz": LOCAL_TIMEZONE, "months_ahead": months_ahead},
    )).mappings().all()
    await db.commit()
    created = [{"organization_id": str(r["organization_id"]), "period_code": r["period_code"]} for r in rows]
    if created:
        logger.info("accounting_periods.opened", periods=created)
    return created
