"""Check that every company revenue/cost figure agrees, against the
configured (production) database, read-only inside a rolled-back
transaction:

  executive KPIs (headline tiles, Revenue vs Cost)
  executive Budget vs Actual (company year to date)
  department P&L consolidated, this calendar year

and that no head-office cost row is counted twice or is a balance-sheet
movement.

    .venv/Scripts/python.exe scripts/verify_one_cost_basis.py
"""

import asyncio
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from _rollback_harness import check, finish, rollback_session  # noqa: E402

import routers.executive as executive  # noqa: E402
import routers.financial_performance as performance  # noqa: E402
from app.services.finance import company_budget  # noqa: E402

ORG = "00000000-0000-0000-0000-000000000001"


def close(a, b) -> bool:
    return abs(float(a or 0) - float(b or 0)) < 0.01


async def main() -> None:
    user = {"org_id": ORG, "permissions": []}
    year = date.today().year
    async with rollback_session() as db:
        kpis = (await executive.get_executive_kpis(user, db))["data"]
        company = (await executive.get_executive_budget_vs_actual(user, db))["data"]["company"]["ytd"]
        pnl = (await performance._compute_department_pnl(db, ORG, date(year, 1, 1), date(year, 12, 31)))["consolidated"]

        print(f"  revenue {kpis['revenue_ytd']:,.2f}  project {kpis['project_cost_ytd']:,.2f}  "
              f"head office {kpis['head_office_cost_ytd']:,.2f}  cost {kpis['cost_ytd']:,.2f}  "
              f"gross {kpis.get('gross_margin_percent')}%  net {kpis.get('margin_percent')}%")
        check(close(kpis["revenue_ytd"], company["actual_revenue"]), "KPI revenue = Budget vs Actual revenue")
        check(close(kpis["cost_ytd"], company["actual_cost"]), "KPI cost = Budget vs Actual cost")
        check(close(kpis["revenue_ytd"], pnl["total_revenue"]), "KPI revenue = Department P&L revenue")
        check(close(kpis["cost_ytd"], pnl["total_cost"]), "KPI cost = Department P&L cost")
        check(close(kpis["head_office_cost_ytd"], pnl["direct_cost_non_project"]), "head-office cost = Department P&L direct cost")
        check(close(kpis["cost_ytd"], kpis["project_cost_ytd"] + kpis["head_office_cost_ytd"]), "cost = project + head office")

        params = company_budget.non_project_cost_params(ORG, date(year, 1, 1), date(year, 12, 31))
        counted_twice = (await db.execute(text("""
            SELECT COUNT(*) FROM finance.cashbook_transactions cb
            WHERE cb.organization_id = :org_id AND cb.project_id IS NULL AND cb.direction = 'outflow'
              AND cb.is_deleted = false AND cb.transaction_date BETWEEN :date_from AND :date_to
              AND COALESCE(cb.source_type, '') <> ALL(:cashbook_elsewhere)
              AND EXISTS (
                SELECT 1 FROM finance.journal_entries je
                WHERE je.organization_id = cb.organization_id AND je.status = 'posted'
                  AND je.source_type = ANY(:gl_sources) AND je.source_id = cb.source_id)
        """), params)).scalar()
        check(counted_twice == 0, "no counted cashbook row also has a GL-only journal")
    finish()


if __name__ == "__main__":
    asyncio.run(main())
