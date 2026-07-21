from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from typing import Optional, List, Any, Dict
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


class CostCodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    category: str = Field(default="materials", max_length=40)


class VariationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    variation_number: str = Field(min_length=1, max_length=40)
    project_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    initiated_by: str = Field(default="client", max_length=40)
    cost_impact: float = 0.0
    time_impact_days: int = 0


class CashAccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    account_code: str = Field(min_length=1, max_length=40)
    account_name: str = Field(min_length=1, max_length=255)
    account_type: str = Field(min_length=1, max_length=24)
    bank_name: Optional[str] = Field(default=None, max_length=160)
    branch_name: Optional[str] = Field(default=None, max_length=160)
    account_number: Optional[str] = Field(default=None, max_length=120)
    currency: str = Field(default="USD", max_length=3)
    opening_balance: float = 0.0


class CashbookTransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cash_account_id: UUID
    transaction_number: str = Field(min_length=1, max_length=40)
    transaction_date: date = Field(default_factory=date.today)
    transaction_type: str = Field(min_length=1, max_length=24)
    direction: str = Field(min_length=1, max_length=8)
    amount: float = Field(gt=0)
    description: str
    project_id: Optional[UUID] = None
    counterparty_type: Optional[str] = Field(default=None, max_length=40)
    counterparty_name: Optional[str] = Field(default=None, max_length=255)
    payment_method: str = Field(default="bank_transfer", max_length=40)
    reference: Optional[str] = Field(default=None, max_length=160)


class ReceiptAllocationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cashbook_transaction_id: UUID
    progress_claim_id: UUID
    project_id: UUID
    allocated_amount: float = Field(gt=0)


class SupplierPaymentItem(BaseModel):
    supplier_invoice_id: UUID
    supplier_id: UUID
    project_id: Optional[UUID] = None
    amount: float = Field(gt=0)
    payment_reference: Optional[str] = Field(default=None, max_length=160)


class SupplierPaymentBatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    batch_number: str = Field(min_length=1, max_length=40)
    cash_account_id: UUID
    payment_date: date = Field(default_factory=date.today)
    payment_method: str = Field(default="bank_transfer", max_length=40)
    reference: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None
    items: List[SupplierPaymentItem]


class EmployeePayProfileUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    employee_id: UUID
    pay_type: str = Field(min_length=1, max_length=24)
    base_rate: float = Field(ge=0)
    overtime_rate: float = Field(default=0.0, ge=0)
    currency: str = Field(default="USD", max_length=3)
    bank_name: Optional[str] = Field(default=None, max_length=160)
    bank_account_number: Optional[str] = Field(default=None, max_length=120)
    tax_number: Optional[str] = Field(default=None, max_length=80)
    nssa_number: Optional[str] = Field(default=None, max_length=80)
    is_active: bool = True


class PayrollItemPayload(BaseModel):
    employee_id: UUID
    project_id: Optional[UUID] = None
    regular_hours: float = 0.0
    overtime_hours: float = 0.0
    gross_pay: float = 0.0
    tax_deduction: float = 0.0
    statutory_deduction: float = 0.0
    other_deduction: float = 0.0
    net_pay: float = 0.0


class PayrollRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    run_number: str = Field(min_length=1, max_length=40)
    period_start: date
    period_end: date
    payment_date: date
    cash_account_id: Optional[UUID] = None
    items: List[PayrollItemPayload]


class PayrollDecisionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: str = Field(min_length=1, max_length=24)


@router.get("/projects")
async def list_project_financial_summaries(
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List running financial metrics for all active projects by dynamically
    aggregating budgets, actual costs, commitments, and progress claims.
    """
    query = text("""
        SELECT 
            p.id AS project_id,
            p.project_code,
            p.name AS project_name,
            p.status AS project_status,
            COALESCE(p.contract_value, 0) AS contract_value,
            
            -- Variations
            COALESCE((
                SELECT SUM(v.cost_impact) 
                FROM finance.variations v 
                WHERE v.project_id = p.id AND v.organization_id = :org_id 
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,
            
            -- Actual Cost (posted transactions)
            COALESCE((
                SELECT SUM(ct.amount) 
                FROM finance.cost_transactions ct 
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
            ), 0) AS actual_cost_to_date,
            
            -- Committed Cost (outstanding PO obligations)
            COALESCE((
                SELECT SUM(c.outstanding_amount) 
                FROM finance.commitments c 
                WHERE c.project_id = p.id AND c.organization_id = :org_id 
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            
            -- Certified Revenue
            COALESCE((
                SELECT SUM(pc.certified_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            
            -- Cash Collected
            COALESCE((
                SELECT SUM(pc.net_claim_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            
            -- Budget Limit
            COALESCE((
                SELECT pb.total_amount 
                FROM finance.project_budgets pb 
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id 
                  AND pb.status = 'approved' AND pb.is_deleted = false 
                LIMIT 1
            ), 0) AS approved_budget
            
        FROM projects.projects p
        WHERE p.organization_id = :org_id AND p.is_deleted = false
        ORDER BY p.name
    """)

    result = await db.execute(query, {"org_id": user["org_id"]})
    summaries = [dict(row._mapping) for row in result]
    return ok(summaries, "Project financial summaries listed.")


@router.get("/projects/{project_id}")
async def get_project_financial_detail(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed financial dashboard structure for a specific project.
    """
    query = text("""
        SELECT 
            p.id AS project_id,
            p.project_code,
            p.name AS project_name,
            p.status AS project_status,
            COALESCE(p.contract_value, 0) AS contract_value,
            
            COALESCE((
                SELECT SUM(v.cost_impact) 
                FROM finance.variations v 
                WHERE v.project_id = p.id AND v.organization_id = :org_id 
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,
            
            COALESCE((
                SELECT SUM(ct.amount) 
                FROM finance.cost_transactions ct 
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
            ), 0) AS actual_cost_to_date,
            
            COALESCE((
                SELECT SUM(c.outstanding_amount) 
                FROM finance.commitments c 
                WHERE c.project_id = p.id AND c.organization_id = :org_id 
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            
            COALESCE((
                SELECT SUM(pc.certified_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            
            COALESCE((
                SELECT SUM(pc.net_claim_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            
            COALESCE((
                SELECT pb.total_amount 
                FROM finance.project_budgets pb 
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id 
                  AND pb.status = 'approved' AND pb.is_deleted = false 
                LIMIT 1
            ), 0) AS approved_budget
            
        FROM projects.projects p
        WHERE p.id = :project_id AND p.organization_id = :org_id AND p.is_deleted = false
    """)

    result = await db.execute(
        query, {"project_id": project_id, "org_id": user["org_id"]}
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Project ledger not found.")

    detail = dict(row._mapping)

    # Check flags
    eac = detail["actual_cost_to_date"] + detail["committed_cost"]
    budget = detail["approved_budget"]
    detail["cost_overrun_risk"] = eac > budget and budget > 0
    detail["cashflow_deficit_risk"] = (
        detail["committed_cost"] > detail["cash_collected"]
    )

    return ok(detail, "Project financial detail retrieved.")


@router.get("/cost-codes")
async def list_cost_codes(
    user: dict = Depends(require_permission("finance.budget.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List all cost codes in the organisation structure.
    """
    result = await db.execute(
        text("""
        SELECT * FROM finance.cost_codes
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY code
    """),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cost codes listed.")


@router.post("/cost-codes", status_code=status.HTTP_201_CREATED)
async def create_cost_code(
    payload: CostCodeCreate,
    user: dict = Depends(require_permission("finance.budget.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new cost code.
    """
    try:
        cost_code_id = (
            await db.execute(
                text("""
            INSERT INTO finance.cost_codes (organization_id, code, name, category)
            VALUES (:org_id, :code, :name, :category)
            RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "code": payload.code,
                    "name": payload.name,
                    "category": payload.category,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(cost_code_id)}, "Cost code created.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cost code already exists.")


@router.get("/variations")
async def list_variations(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("finance.variation.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List variations, optionally filtered by project or status.
    """
    query_str = """
        SELECT v.*, p.name AS project_name
        FROM finance.variations v
        JOIN projects.projects p ON p.id = v.project_id AND p.organization_id = v.organization_id
        WHERE v.organization_id = :org_id AND v.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND v.project_id = :project_id"
        params["project_id"] = project_id
    if status_filter:
        query_str += " AND v.status = :status"
        params["status"] = status_filter

    query_str += " ORDER BY v.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Variations listed.")


@router.post("/variations", status_code=status.HTTP_201_CREATED)
async def create_variation(
    payload: VariationCreate,
    user: dict = Depends(require_permission("finance.variation.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new variation order.
    """
    # Verify project
    proj = await db.execute(
        text(
            "SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"
        ),
        {"id": payload.project_id, "org_id": user["org_id"]},
    )
    if not proj.first():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        var_id = (
            await db.execute(
                text("""
            INSERT INTO finance.variations (
                organization_id, variation_number, project_id, title, description,
                initiated_by, cost_impact, time_impact_days, status
            ) VALUES (
                :org_id, :variation_number, :project_id, :title, :description,
                :initiated_by, :cost_impact, :time_impact_days, 'pending'
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "variation_number": payload.variation_number,
                    "project_id": payload.project_id,
                    "title": payload.title,
                    "description": payload.description,
                    "initiated_by": payload.initiated_by,
                    "cost_impact": payload.cost_impact,
                    "time_impact_days": payload.time_impact_days,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(var_id)}, "Variation order recorded.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Variation number already exists.")


@router.get("/progress-claims")
async def list_progress_claims(
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.claim.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List progress claims, optionally filtered by project.
    """
    query_str = """
        SELECT pc.*, p.name AS project_name
        FROM finance.progress_claims pc
        JOIN projects.projects p ON p.id = pc.project_id AND p.organization_id = pc.organization_id
        WHERE pc.organization_id = :org_id AND pc.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND pc.project_id = :project_id"
        params["project_id"] = project_id

    query_str += " ORDER BY pc.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Progress claims listed.")


@router.get("/cash-accounts")
async def get_cash_accounts(
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM finance.cash_accounts WHERE organization_id = :org_id AND is_deleted = false ORDER BY account_code"),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cash accounts retrieved.")


@router.post("/cash-accounts", status_code=status.HTTP_201_CREATED)
async def create_cash_account(
    payload: CashAccountCreate,
    user: dict = Depends(require_permission("finance.cash.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        acc_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.cash_accounts (
                        organization_id, account_code, account_name, account_type,
                        bank_name, branch_name, account_number, currency,
                        opening_balance, current_balance, created_by
                    ) VALUES (
                        :org_id, :account_code, :account_name, :account_type,
                        :bank_name, :branch_name, :account_number, :currency,
                        :opening_balance, :opening_balance, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "account_code": payload.account_code,
                    "account_name": payload.account_name,
                    "account_type": payload.account_type,
                    "bank_name": payload.bank_name,
                    "branch_name": payload.branch_name,
                    "account_number": payload.account_number,
                    "currency": payload.currency,
                    "opening_balance": payload.opening_balance,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(acc_id)}, "Cash account created successfully.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cash account code already exists.")


@router.get("/cashbook")
async def get_cashbook(
    cash_account_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    query = "SELECT * FROM finance.cashbook_transactions WHERE organization_id = :org_id AND is_deleted = false"
    params = {"org_id": user["org_id"]}
    if cash_account_id:
        query += " AND cash_account_id = :cash_account_id"
        params["cash_account_id"] = cash_account_id
    if project_id:
        query += " AND project_id = :project_id"
        params["project_id"] = project_id
    query += " ORDER BY transaction_date DESC, created_at DESC"
    
    result = await db.execute(text(query), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cashbook transactions retrieved.")


@router.post("/cashbook", status_code=status.HTTP_201_CREATED)
async def post_cashbook_transaction(
    payload: CashbookTransactionCreate,
    user: dict = Depends(require_permission("finance.cash.post")),
    db: AsyncSession = Depends(get_db),
):
    try:
        # Verify cash account exists
        acc_check = await db.execute(
            text("SELECT 1 FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.cash_account_id, "org_id": user["org_id"]},
        )
        if not acc_check.first():
            raise HTTPException(status_code=404, detail="Cash account not found.")

        tx_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.cashbook_transactions (
                        organization_id, cash_account_id, transaction_number, transaction_date,
                        transaction_type, direction, amount, currency, description,
                        project_id, counterparty_type, counterparty_name, payment_method,
                        reference, posted_by
                    ) VALUES (
                        :org_id, :cash_account_id, :transaction_number, :transaction_date,
                        :transaction_type, :direction, :amount, :currency, :description,
                        :project_id, :counterparty_type, :counterparty_name, :payment_method,
                        :reference, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "cash_account_id": payload.cash_account_id,
                    "transaction_number": payload.transaction_number,
                    "transaction_date": payload.transaction_date,
                    "transaction_type": payload.transaction_type,
                    "direction": payload.direction,
                    "amount": payload.amount,
                    "currency": "USD",
                    "description": payload.description,
                    "project_id": payload.project_id,
                    "counterparty_type": payload.counterparty_type,
                    "counterparty_name": payload.counterparty_name,
                    "payment_method": payload.payment_method,
                    "reference": payload.reference,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        
        # Update account balance
        balance_adj = payload.amount if payload.direction == "inflow" else -payload.amount
        await db.execute(
            text("UPDATE finance.cash_accounts SET current_balance = current_balance + :adj WHERE id = :id"),
            {"adj": balance_adj, "id": payload.cash_account_id},
        )
        
        await db.commit()
        return ok({"id": str(tx_id)}, "Cashbook transaction posted.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Transaction number already exists.")


@router.post("/receipts/allocate", status_code=status.HTTP_201_CREATED)
async def allocate_receipt(
    payload: ReceiptAllocationCreate,
    user: dict = Depends(require_permission("finance.receipt.allocate")),
    db: AsyncSession = Depends(get_db),
):
    try:
        alloc_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.receipt_allocations (
                        organization_id, cashbook_transaction_id, progress_claim_id,
                        project_id, allocated_amount, allocated_by
                    ) VALUES (
                        :org_id, :cashbook_transaction_id, :progress_claim_id,
                        :project_id, :allocated_amount, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "cashbook_transaction_id": payload.cashbook_transaction_id,
                    "progress_claim_id": payload.progress_claim_id,
                    "project_id": payload.project_id,
                    "allocated_amount": payload.allocated_amount,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(alloc_id)}, "Receipt allocated successfully.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Allocation already exists or invalid references.")


@router.get("/supplier-payments")
async def get_supplier_payments(
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM finance.supplier_payment_batches WHERE organization_id = :org_id AND is_deleted = false ORDER BY created_at DESC"),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Supplier payment batches retrieved.")


@router.post("/supplier-payments", status_code=status.HTTP_201_CREATED)
async def post_supplier_payment_batch(
    payload: SupplierPaymentBatchCreate,
    user: dict = Depends(require_permission("finance.supplier_payment.post")),
    db: AsyncSession = Depends(get_db),
):
    try:
        total_amt = sum(item.amount for item in payload.items)
        batch_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.supplier_payment_batches (
                        organization_id, batch_number, cash_account_id, payment_date,
                        status, total_amount, payment_method, reference, notes, created_by
                    ) VALUES (
                        :org_id, :batch_number, :cash_account_id, :payment_date,
                        'posted', :total_amount, :payment_method, :reference, :notes, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "batch_number": payload.batch_number,
                    "cash_account_id": payload.cash_account_id,
                    "payment_date": payload.payment_date,
                    "total_amount": total_amt,
                    "payment_method": payload.payment_method,
                    "reference": payload.reference,
                    "notes": payload.notes,
                    "user_id": user["sub"],
                },
            )
        ).scalar()

        for item in payload.items:
            tx_number = f"PMT-{payload.batch_number}-{str(item.supplier_invoice_id)[:8]}"
            tx_id = (
                await db.execute(
                    text("""
                        INSERT INTO finance.cashbook_transactions (
                            organization_id, cash_account_id, transaction_number, transaction_date,
                            transaction_type, direction, amount, currency, description,
                            project_id, counterparty_type, counterparty_name, payment_method,
                            reference, posted_by
                        ) VALUES (
                            :org_id, :cash_account_id, :tx_number, :payment_date,
                            'payment', 'outflow', :amount, 'USD', :desc,
                            :project_id, 'supplier', '', :payment_method,
                            :reference, :user_id
                        ) RETURNING id
                    """),
                    {
                        "org_id": user["org_id"],
                        "cash_account_id": payload.cash_account_id,
                        "tx_number": tx_number,
                        "payment_date": payload.payment_date,
                        "amount": item.amount,
                        "desc": f"Supplier payment batch item. Invoice {item.supplier_invoice_id}",
                        "project_id": item.project_id,
                        "payment_method": payload.payment_method,
                        "reference": item.payment_reference or payload.reference,
                        "user_id": user["sub"],
                    }
                )
            ).scalar()

            await db.execute(
                text("""
                    INSERT INTO finance.supplier_payment_items (
                        organization_id, batch_id, supplier_invoice_id, supplier_id,
                        project_id, amount, payment_reference, cashbook_transaction_id
                    ) VALUES (
                        :org_id, :batch_id, :supplier_invoice_id, :supplier_id,
                        :project_id, :amount, :payment_ref, :tx_id
                    )
                """),
                {
                    "org_id": user["org_id"],
                    "batch_id": batch_id,
                    "supplier_invoice_id": item.supplier_invoice_id,
                    "supplier_id": item.supplier_id,
                    "project_id": item.project_id,
                    "amount": item.amount,
                    "payment_ref": item.payment_reference,
                    "tx_id": tx_id,
                  }
              )

            await db.execute(
                text("UPDATE finance.cash_accounts SET current_balance = current_balance - :amount WHERE id = :id"),
                {"amount": item.amount, "id": payload.cash_account_id},
            )

        await db.commit()
        return ok({"id": str(batch_id)}, "Supplier payment batch posted successfully.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Supplier payment batch number or items duplicate conflict.")


@router.get("/payroll/profiles")
async def get_payroll_profiles(
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM finance.employee_pay_profiles WHERE organization_id = :org_id AND is_deleted = false"),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Payroll profiles retrieved.")


@router.post("/payroll/profiles", status_code=status.HTTP_201_CREATED)
async def upsert_payroll_profile(
    payload: EmployeePayProfileUpsert,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        check = await db.execute(
            text("SELECT id FROM finance.employee_pay_profiles WHERE employee_id = :emp_id AND organization_id = :org_id AND is_deleted = false"),
            {"emp_id": payload.employee_id, "org_id": user["org_id"]},
        )
        row = check.first()
        if row:
            profile_id = row[0]
            await db.execute(
                text("""
                    UPDATE finance.employee_pay_profiles
                    SET pay_type = :pay_type, base_rate = :base_rate, overtime_rate = :overtime_rate,
                        currency = :currency, bank_name = :bank_name, bank_account_number = :bank_account_number,
                        tax_number = :tax_number, nssa_number = :nssa_number, is_active = :is_active,
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {
                    "pay_type": payload.pay_type,
                    "base_rate": payload.base_rate,
                    "overtime_rate": payload.overtime_rate,
                    "currency": payload.currency,
                    "bank_name": payload.bank_name,
                    "bank_account_number": payload.bank_account_number,
                    "tax_number": payload.tax_number,
                    "nssa_number": payload.nssa_number,
                    "is_active": payload.is_active,
                    "id": profile_id,
                }
            )
            msg = "Payroll profile updated."
        else:
            profile_id = (
                await db.execute(
                    text("""
                        INSERT INTO finance.employee_pay_profiles (
                            organization_id, employee_id, pay_type, base_rate, overtime_rate,
                            currency, bank_name, bank_account_number, tax_number, nssa_number,
                            is_active, created_by
                        ) VALUES (
                            :org_id, :employee_id, :pay_type, :base_rate, :overtime_rate,
                            :currency, :bank_name, :bank_account_number, :tax_number, :nssa_number,
                            :is_active, :user_id
                        ) RETURNING id
                    """),
                    {
                        "org_id": user["org_id"],
                        "employee_id": payload.employee_id,
                        "pay_type": payload.pay_type,
                        "base_rate": payload.base_rate,
                        "overtime_rate": payload.overtime_rate,
                        "currency": payload.currency,
                        "bank_name": payload.bank_name,
                        "bank_account_number": payload.bank_account_number,
                        "tax_number": payload.tax_number,
                        "nssa_number": payload.nssa_number,
                        "is_active": payload.is_active,
                        "user_id": user["sub"],
                    }
                )
            ).scalar()
            msg = "Payroll profile created."

        await db.commit()
        return ok({"id": str(profile_id)}, msg)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/payroll/runs")
async def get_payroll_runs(
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM finance.payroll_runs WHERE organization_id = :org_id AND is_deleted = false ORDER BY created_at DESC"),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Payroll runs retrieved.")


@router.post("/payroll/runs", status_code=status.HTTP_201_CREATED)
async def create_payroll_run(
    payload: PayrollRunCreate,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        gross = sum(item.gross_pay for item in payload.items)
        deductions = sum(item.tax_deduction + item.statutory_deduction + item.other_deduction for item in payload.items)
        net = sum(item.net_pay for item in payload.items)

        run_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.payroll_runs (
                        organization_id, run_number, period_start, period_end, payment_date,
                        status, gross_pay, total_deductions, net_pay, created_by
                    ) VALUES (
                        :org_id, :run_number, :period_start, :period_end, :payment_date,
                        'draft', :gross, :deductions, :net, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "run_number": payload.run_number,
                    "period_start": payload.period_start,
                    "period_end": payload.period_end,
                    "payment_date": payload.payment_date,
                    "gross": gross,
                    "deductions": deductions,
                    "net": net,
                    "user_id": user["sub"],
                }
            )
        ).scalar()

        for item in payload.items:
            await db.execute(
                text("""
                    INSERT INTO finance.payroll_items (
                        organization_id, payroll_run_id, employee_id, project_id,
                        regular_hours, overtime_hours, gross_pay, tax_deduction,
                        statutory_deduction, other_deduction, net_pay
                    ) VALUES (
                        :org_id, :run_id, :employee_id, :project_id,
                        :regular_hours, :overtime_hours, :gross_pay, :tax_deduction,
                        :statutory_deduction, :other_deduction, :net_pay
                    )
                """),
                {
                    "org_id": user["org_id"],
                    "run_id": run_id,
                    "employee_id": item.employee_id,
                    "project_id": item.project_id,
                    "regular_hours": item.regular_hours,
                    "overtime_hours": item.overtime_hours,
                    "gross_pay": item.gross_pay,
                    "tax_deduction": item.tax_deduction,
                    "statutory_deduction": item.statutory_deduction,
                    "other_deduction": item.other_deduction,
                    "net_pay": item.net_pay,
                }
            )

        await db.commit()
        return ok({"id": str(run_id)}, "Payroll run generated in draft.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Payroll run number already exists.")


@router.post("/payroll/runs/{run_id}/decision")
async def decide_payroll_run(
    run_id: UUID,
    payload: PayrollDecisionPayload,
    user: dict = Depends(require_permission("finance.payroll.post")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE finance.payroll_runs
            SET status = :status, approved_by = :user_id, approved_at = NOW(), updated_at = NOW()
            WHERE id = :run_id AND organization_id = :org_id AND is_deleted = false AND status = 'draft'
            RETURNING id
        """),
        {
            "status": payload.status,
            "user_id": user["sub"],
            "run_id": run_id,
            "org_id": user["org_id"],
        }
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Draft payroll run not found.")

    await db.commit()
    return ok({"id": str(run_id)}, f"Payroll run status updated to {payload.status}.")


@router.post("/payroll/runs/{run_id}/post")
async def post_payroll_run(
    run_id: UUID,
    user: dict = Depends(require_permission("finance.payroll.post")),
    db: AsyncSession = Depends(get_db),
):
    run_result = await db.execute(
        text("SELECT * FROM finance.payroll_runs WHERE id = :id AND organization_id = :org_id AND is_deleted = false AND status = 'approved'"),
        {"id": run_id, "org_id": user["org_id"]},
    )
    run = run_result.first()
    if not run:
        raise HTTPException(status_code=404, detail="Approved payroll run not found.")

    run_data = dict(run._mapping)
    cash_account_id = run_data["cash_account_id"]
    if not cash_account_id:
        acc_check = await db.execute(
            text("SELECT id FROM finance.cash_accounts WHERE organization_id = :org_id AND is_active = true AND is_deleted = false LIMIT 1"),
            {"org_id": user["org_id"]},
        )
        acc_row = acc_check.first()
        if not acc_row:
            raise HTTPException(status_code=400, detail="No active cash account available to post payroll.")
        cash_account_id = acc_row[0]

    tx_number = f"PAY-{run_data['run_number']}"
    tx_id = (
        await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, amount, currency, description,
                    posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :tx_number, :payment_date,
                    'payment', 'outflow', :amount, 'USD', :desc, :user_id
                ) RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "cash_account_id": cash_account_id,
                "tx_number": tx_number,
                "payment_date": run_data["payment_date"],
                "amount": run_data["net_pay"],
                "desc": f"Payroll posting for run {run_data['run_number']}",
                "user_id": user["sub"],
            }
        )
    ).scalar()

    await db.execute(
        text("""
            UPDATE finance.payroll_runs
            SET status = 'posted', posted_by = :user_id, posted_at = NOW(),
                cash_account_id = :cash_account_id, updated_at = NOW()
            WHERE id = :run_id
        """),
        {
            "user_id": user["sub"],
            "cash_account_id": cash_account_id,
            "run_id": run_id,
        }
    )

    await db.execute(
        text("""
            UPDATE finance.payroll_items
            SET cashbook_transaction_id = :tx_id
            WHERE payroll_run_id = :run_id
        """),
        {"tx_id": tx_id, "run_id": run_id}
    )

    await db.execute(
        text("UPDATE finance.cash_accounts SET current_balance = current_balance - :amount WHERE id = :id"),
        {"amount": run_data["net_pay"], "id": cash_account_id},
    )

    await db.commit()
    return ok({"id": str(run_id)}, "Payroll run posted and cashbook outflow recorded.")
