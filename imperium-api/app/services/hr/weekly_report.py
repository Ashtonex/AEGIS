"""Friday HR report: who worked this week, their days, hours and estimated
wages, and - most importantly - every vendor/subcontractor still waiting on
verification. Emailed by app.workers.arq_worker.weekly_hr_report_job.

The week is the seven days ending on the report's Friday (Saturday to
Friday), so weekend site work is never skipped between reports. Times are
Harare time (CAT, UTC+2, no daylight saving).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html import escape
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.vendor_verification import run_system_verification_check, vendor_profile_columns
from core.logging import logger

HARARE = timezone(timedelta(hours=2), "CAT")
SEND_WEEKDAY = 4  # Friday
SEND_HOUR = 16  # 16:00 Harare time
WEEKS_PER_MONTH = Decimal(52) / Decimal(12)

PENDING_VENDOR_STAGES = ("incomplete", "system_pending", "system_verified")
VENDOR_STAGE_LABELS = {
    "system_verified": "Awaiting HR decision",
    "system_pending": "Missing information",
    "incomplete": "Not yet checked",
}


def report_week(now: datetime) -> tuple[date, date]:
    """(Saturday, Friday) of the week ending on the most recent Friday on or
    before now (Harare time)."""
    today = now.astimezone(HARARE).date()
    end = today - timedelta(days=(today.weekday() - SEND_WEEKDAY) % 7)
    return end - timedelta(days=6), end


def is_send_time(now: datetime) -> bool:
    """Friday from 16:00 Harare time. The worker runs hourly on Fridays, so
    later runs retry any recipient that hasn't been sent to yet."""
    local = now.astimezone(HARARE)
    return local.weekday() == SEND_WEEKDAY and local.hour >= SEND_HOUR


def estimate_weekly_gross(
    pay_type: Optional[str],
    base_rate: Any,
    overtime_rate: Any,
    days_worked: int,
    regular_hours: Any,
    overtime_hours: Any,
) -> Optional[Decimal]:
    """Estimated gross pay for the week, before PAYE/NSSA, from the pay
    profile. Uses routers.payroll_runs' rules for hourly and daily pay; a
    monthly salary is its weekly share (x12/52) plus overtime. None when
    there's no pay profile."""
    if not pay_type or base_rate is None:
        return None
    base = Decimal(str(base_rate))
    ot_rate = Decimal(str(overtime_rate or 0))
    regular = Decimal(str(regular_hours or 0))
    overtime = Decimal(str(overtime_hours or 0))
    if pay_type == "hourly":
        gross = regular * base + overtime * (ot_rate or base * Decimal("1.5"))
    elif pay_type == "daily":
        gross = Decimal(days_worked) * base + overtime * (ot_rate or base / 8 * Decimal("1.5"))
    else:  # monthly_salary, or anything else paid as a fixed salary
        gross = base / WEEKS_PER_MONTH + overtime * ot_rate
    return gross.quantize(Decimal("0.01"))


@dataclass
class WorkforceLine:
    employee_name: str
    job_title: Optional[str]
    days_worked: int
    regular_hours: Decimal
    overtime_hours: Decimal
    days_pending_approval: int
    pay_type: Optional[str]
    currency: Optional[str]
    estimated_gross: Optional[Decimal]


@dataclass
class PendingVendor:
    name: str
    account_type: str
    stage: str
    days_waiting: int
    registration_number: Optional[str]
    tax_clearance_number: Optional[str]
    vat_status: Optional[str]
    vat_number: Optional[str]
    outstanding: Optional[str]


@dataclass
class WeeklyHrReport:
    organization_name: str
    week_start: date
    week_end: date
    workforce: list[WorkforceLine] = field(default_factory=list)
    pending_vendors: list[PendingVendor] = field(default_factory=list)

    @property
    def people_working(self) -> list[WorkforceLine]:
        return [line for line in self.workforce if line.days_worked > 0]

    @property
    def total_days(self) -> int:
        return sum(line.days_worked for line in self.workforce)

    @property
    def total_regular_hours(self) -> Decimal:
        return sum((line.regular_hours for line in self.workforce), Decimal(0))

    @property
    def total_overtime_hours(self) -> Decimal:
        return sum((line.overtime_hours for line in self.workforce), Decimal(0))

    @property
    def wages_by_currency(self) -> dict[str, Decimal]:
        totals: dict[str, Decimal] = {}
        for line in self.workforce:
            if line.estimated_gross is not None:
                currency = line.currency or "USD"
                totals[currency] = totals.get(currency, Decimal(0)) + line.estimated_gross
        return totals


_WORKFORCE_SQL = """
WITH ts AS (
    SELECT t.employee_id, t.work_date AS day,
           SUM(t.regular_hours) AS reg, SUM(t.overtime_hours) AS ot,
           bool_and(t.status = 'approved') AS approved
    FROM hr.timesheets t
    WHERE t.organization_id = :org_id AND t.is_deleted = false
      AND t.status <> 'rejected'
      AND t.work_date BETWEEN :start_date AND :end_date
    GROUP BY 1, 2
), att AS (
    SELECT a.employee_id, a.attendance_date AS day,
           SUM(a.regular_hours) AS reg, SUM(a.overtime_hours) AS ot
    FROM hr.attendance_records a
    WHERE a.organization_id = :org_id AND a.is_deleted = false
      AND a.status IN ('present', 'late', 'half_day', 'public_holiday')
      AND a.attendance_date BETWEEN :start_date AND :end_date
    GROUP BY 1, 2
), worked AS (
    -- One row per employee-day. A timesheet's hours win over the attendance
    -- record for the same day; attendance alone still counts as a day worked.
    SELECT COALESCE(ts.employee_id, att.employee_id) AS employee_id,
           COALESCE(ts.day, att.day) AS day,
           COALESCE(ts.reg, att.reg, 0) AS reg,
           COALESCE(ts.ot, att.ot, 0) AS ot,
           (ts.employee_id IS NOT NULL AND NOT ts.approved) AS pending_approval
    FROM ts FULL JOIN att ON att.employee_id = ts.employee_id AND att.day = ts.day
)
SELECT e.employee_name, e.job_title,
       COUNT(w.day) AS days_worked,
       COALESCE(SUM(w.reg), 0) AS regular_hours,
       COALESCE(SUM(w.ot), 0) AS overtime_hours,
       COUNT(w.day) FILTER (WHERE w.pending_approval) AS days_pending_approval,
       pp.pay_type, pp.base_rate, pp.overtime_rate, pp.currency
FROM hr.employees e
LEFT JOIN worked w ON w.employee_id = e.id
LEFT JOIN LATERAL (
    SELECT pay_type, base_rate, overtime_rate, currency
    FROM finance.employee_pay_profiles pp
    WHERE pp.organization_id = e.organization_id AND pp.employee_id = e.id
      AND pp.is_active = true AND pp.is_deleted = false
    ORDER BY pp.updated_at DESC
    LIMIT 1
) pp ON true
WHERE e.organization_id = :org_id AND e.is_deleted = false AND e.employment_status = 'active'
GROUP BY e.id, e.employee_name, e.job_title, pp.pay_type, pp.base_rate, pp.overtime_rate, pp.currency
ORDER BY days_worked DESC, e.employee_name
"""

_PENDING_VENDORS_SQL = f"""
SELECT {vendor_profile_columns("name", "registration_number", "tax_clearance_number", "vat_status", "vat_number")},
       COALESCE(s.submission_data->>'account_type', 'vendor') AS account_type,
       s.verification_stage AS stage,
       s.system_verification_notes AS outstanding,
       GREATEST(0, (CAST(:end_date AS date) - s.created_at::date)) AS days_waiting
FROM crm.subcontractors s
LEFT JOIN procurement.suppliers ps
  ON ps.id = s.linked_supplier_id
 AND ps.organization_id = s.organization_id
 AND ps.is_deleted = false
WHERE s.organization_id = :org_id AND s.is_deleted = false
  AND s.verification_stage IN ('incomplete', 'system_pending', 'system_verified')
ORDER BY CASE s.verification_stage WHEN 'system_verified' THEN 0 WHEN 'system_pending' THEN 1 ELSE 2 END,
         s.created_at
"""


async def refresh_pending_vendor_checks(db: AsyncSession, *, org_id: str) -> int:
    """Re-runs the automated verification check for every vendor still
    pending, so the report's "outstanding" column reflects today's data and
    rules rather than whatever was stored when the vendor was last checked.
    Same effect as HR's "Run system check" button. Returns how many were
    checked; a vendor whose check fails is logged and left as it was."""
    ids = (
        await db.execute(
            text("""
                SELECT id FROM crm.subcontractors
                WHERE organization_id = :org_id AND is_deleted = false
                  AND verification_stage IN ('incomplete', 'system_pending', 'system_verified')
            """),
            {"org_id": org_id},
        )
    ).scalars().all()
    checked = 0
    for subcontractor_id in ids:
        try:
            async with db.begin_nested():
                await run_system_verification_check(db, org_id=org_id, subcontractor_id=str(subcontractor_id))
            checked += 1
        except Exception:
            logger.exception("Weekly HR report: vendor check failed", subcontractor_id=str(subcontractor_id))
    return checked


async def build_weekly_hr_report(
    db: AsyncSession, *, org_id: str, week_start: date, week_end: date
) -> WeeklyHrReport:
    params = {"org_id": org_id, "start_date": week_start, "end_date": week_end}
    org_name = (
        await db.execute(text("SELECT name FROM core.organizations WHERE id = :org_id"), {"org_id": org_id})
    ).scalar() or "AEGIS"

    workforce = []
    for row in (await db.execute(text(_WORKFORCE_SQL), params)).mappings():
        days = int(row["days_worked"] or 0)
        workforce.append(
            WorkforceLine(
                employee_name=row["employee_name"],
                job_title=row["job_title"],
                days_worked=days,
                regular_hours=Decimal(str(row["regular_hours"] or 0)),
                overtime_hours=Decimal(str(row["overtime_hours"] or 0)),
                days_pending_approval=int(row["days_pending_approval"] or 0),
                pay_type=row["pay_type"],
                currency=row["currency"],
                estimated_gross=estimate_weekly_gross(
                    row["pay_type"], row["base_rate"], row["overtime_rate"],
                    days, row["regular_hours"], row["overtime_hours"],
                ),
            )
        )

    pending_vendors = [
        PendingVendor(
            name=row["name"] or "Unnamed vendor",
            account_type=row["account_type"],
            stage=row["stage"],
            days_waiting=int(row["days_waiting"] or 0),
            registration_number=row["registration_number"],
            tax_clearance_number=row["tax_clearance_number"],
            vat_status=row["vat_status"],
            vat_number=row["vat_number"],
            outstanding=row["outstanding"],
        )
        for row in (await db.execute(text(_PENDING_VENDORS_SQL), params)).mappings()
    ]

    return WeeklyHrReport(
        organization_name=org_name,
        week_start=week_start,
        week_end=week_end,
        workforce=workforce,
        pending_vendors=pending_vendors,
    )


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _period(report: WeeklyHrReport) -> str:
    start, end = report.week_start, report.week_end
    if start.month == end.month:
        return f"{start.day} to {end.day} {end:%b %Y}"
    return f"{start.day} {start:%b} to {end.day} {end:%b %Y}"


def _hours(value: Decimal) -> str:
    return f"{value.normalize():f}" if value == value.to_integral() else f"{value:.2f}"


def _money(amount: Decimal, currency: Optional[str]) -> str:
    return f"{currency or 'USD'} {amount:,.2f}"


def _wages_total(report: WeeklyHrReport) -> str:
    totals = report.wages_by_currency
    return " + ".join(_money(amount, currency) for currency, amount in sorted(totals.items())) or "–"


def _vat_text(vendor: PendingVendor) -> str:
    if vendor.vat_status == "not_registered":
        return "Not registered"
    return vendor.vat_number or "Missing"


def report_subject(report: WeeklyHrReport) -> str:
    pending = len(report.pending_vendors)
    vendors = f"{pending} vendor{'s' if pending != 1 else ''} pending verification"
    return f"AEGIS weekly HR report, {_period(report)}: {vendors}"


_CELL = "padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:13px;vertical-align:top;"
_HEAD = "padding:6px 8px;border-bottom:2px solid #1a1a1a;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;text-align:left;color:#555;"
_MISSING = "color:#b42318;font-weight:600;"


def _table(headers: list[str], rows: list[list[str]], empty: str) -> str:
    if not rows:
        return f'<p style="font-size:13px;color:#555;">{escape(empty)}</p>'
    head = "".join(f'<th style="{_HEAD}">{escape(h)}</th>' for h in headers)
    body = "".join("<tr>" + "".join(f'<td style="{_CELL}">{cell}</td>' for cell in row) + "</tr>" for row in rows)
    return f'<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def _key_value(value: Optional[str]) -> str:
    return escape(value) if value else f'<span style="{_MISSING}">Missing</span>'


def render_weekly_hr_report_html(report: WeeklyHrReport, *, app_url: Optional[str] = None) -> str:
    people = report.people_working
    summary = [
        ("People working", f"{len(people)} of {len(report.workforce)}"),
        ("Days worked", str(report.total_days)),
        ("Hours", f"{_hours(report.total_regular_hours)} + {_hours(report.total_overtime_hours)} OT"),
        ("Est. gross wages", _wages_total(report)),
        ("Vendors pending", str(len(report.pending_vendors))),
    ]
    summary_html = "".join(
        f'<td style="padding:10px 12px;border:1px solid #e5e5e5;">'
        f'<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#777;">{escape(label)}</div>'
        f'<div style="font-size:18px;font-weight:700;margin-top:4px;">{escape(value)}</div></td>'
        for label, value in summary
    )

    vendor_rows = [
        [
            f"<strong>{escape(v.name)}</strong><br><span style=\"color:#777;font-size:12px;\">{escape(v.account_type.title())}</span>",
            escape(VENDOR_STAGE_LABELS.get(v.stage, v.stage)),
            f"{v.days_waiting} day{'s' if v.days_waiting != 1 else ''}",
            _key_value(v.registration_number),
            _key_value(v.tax_clearance_number),
            escape(_vat_text(v)) if _vat_text(v) != "Missing" else _key_value(None),
            escape(v.outstanding or ("Ready for HR review" if v.stage == "system_verified" else "Not yet checked")),
        ]
        for v in report.pending_vendors
    ]

    def workforce_note(line: WorkforceLine) -> str:
        notes = []
        if line.days_worked == 0:
            notes.append("No time recorded")
        if line.days_pending_approval:
            notes.append(f"{line.days_pending_approval} day(s) awaiting timesheet approval")
        if line.estimated_gross is None:
            notes.append("No pay profile")
        return escape("; ".join(notes))

    workforce_rows = [
        [
            f"<strong>{escape(line.employee_name)}</strong>"
            + (f'<br><span style="color:#777;font-size:12px;">{escape(line.job_title)}</span>' if line.job_title else ""),
            str(line.days_worked),
            _hours(line.regular_hours),
            _hours(line.overtime_hours),
            escape(_money(line.estimated_gross, line.currency)) if line.estimated_gross is not None else "–",
            workforce_note(line),
        ]
        for line in report.workforce
    ]

    link = ""
    if app_url:
        href = escape(f"{app_url.rstrip('/')}/dashboard/hr?tab=vendor-verification", quote=True)
        link = f'<p style="margin:12px 0 0;"><a href="{href}" style="color:#b8860b;font-weight:600;">Open vendor verification in AEGIS</a></p>'

    return f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:860px;margin:0 auto;color:#1a1a1a;">
  <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8860b;font-weight:700;margin:0 0 4px;">AEGIS · {escape(report.organization_name)}</p>
  <h1 style="font-size:22px;margin:0 0 4px;">Weekly HR report</h1>
  <p style="font-size:13px;color:#555;margin:0 0 16px;">Saturday {report.week_start.day} {report.week_start:%b} to Friday {report.week_end.day} {report.week_end:%b %Y}</p>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-bottom:24px;"><tr>{summary_html}</tr></table>

  <h2 style="font-size:16px;margin:0 0 8px;">Vendors pending verification ({len(report.pending_vendors)})</h2>
  <p style="font-size:12px;color:#555;margin:0 0 8px;">Verification needs the registered company name, company registration number, tax clearance and VAT (number and certificate, or declared not VAT registered).</p>
  {_table(["Vendor", "Stage", "Waiting", "Company reg. no.", "Tax clearance", "VAT", "Outstanding"], vendor_rows, "No vendors are waiting on verification.")}
  {link}

  <h2 style="font-size:16px;margin:28px 0 8px;">Workforce this week</h2>
  {_table(["Employee", "Days worked", "Hours", "Overtime", "Est. gross wages", "Notes"], workforce_rows, "No active employees.")}

  <p style="font-size:11px;color:#777;margin-top:20px;line-height:1.5;">
    Days and hours come from timesheets (not rejected) and attendance records marked present, late, half day or public holiday; where both exist for a day, the timesheet's hours are used.
    Wages are estimated gross pay before PAYE and NSSA, from each employee's pay profile: monthly salaries are shown as a weekly share (×12/52) plus overtime.
    Payroll runs remain the record of what is actually paid.
  </p>
</div>"""


def render_weekly_hr_report_text(report: WeeklyHrReport) -> str:
    lines = [
        f"AEGIS weekly HR report - {report.organization_name}",
        f"Saturday {report.week_start.day} {report.week_start:%b} to Friday {report.week_end.day} {report.week_end:%b %Y}",
        "",
        f"People working: {len(report.people_working)} of {len(report.workforce)}",
        f"Days worked: {report.total_days}",
        f"Hours: {_hours(report.total_regular_hours)} + {_hours(report.total_overtime_hours)} overtime",
        f"Estimated gross wages: {_wages_total(report)}",
        "",
        f"VENDORS PENDING VERIFICATION ({len(report.pending_vendors)})",
    ]
    for v in report.pending_vendors:
        lines.append(
            f"- {v.name} ({v.account_type}) - {VENDOR_STAGE_LABELS.get(v.stage, v.stage)}, waiting {v.days_waiting} days. "
            f"Reg: {v.registration_number or 'MISSING'}; Tax clearance: {v.tax_clearance_number or 'MISSING'}; VAT: {_vat_text(v)}"
        )
        if v.outstanding:
            lines.append(f"  Outstanding: {v.outstanding}")
    if not report.pending_vendors:
        lines.append("None.")
    lines += ["", "WORKFORCE THIS WEEK"]
    for line in report.workforce:
        wages = _money(line.estimated_gross, line.currency) if line.estimated_gross is not None else "no pay profile"
        lines.append(
            f"- {line.employee_name}: {line.days_worked} days, {_hours(line.regular_hours)} h"
            f" + {_hours(line.overtime_hours)} OT, est. {wages}"
        )
    return "\n".join(lines)
