"""AI Financial Control Assistant (Phase 10B) - read/explain-only endpoints.

POST /ask is the only way to invoke the assistant; GET /audit-log lets an
authorized reviewer see what has been asked and answered. Neither endpoint
can trigger any write to finance data - see
app/services/finance/ai_assistant_tools.py's module docstring for why
that is structurally true, not just a convention.
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import ai_assistant
from app.shared.pagination import ok
from core.database import get_db
from core.security import get_user_permission_keys, require_permission

router = APIRouter()


class AssistantHistoryTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str


class AssistantAskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)
    history: List[AssistantHistoryTurn] = Field(default_factory=list)


@router.post("/ask")
async def ask_assistant(
    payload: AssistantAskRequest,
    user: dict = Depends(require_permission("finance.ai_assistant.use")),
    db: AsyncSession = Depends(get_db),
):
    user_permissions = await get_user_permission_keys(db, user)
    result = await ai_assistant.answer_question(
        db,
        org_id=user["org_id"],
        user_id=user.get("user_id"),
        user_permissions=user_permissions,
        question=payload.question,
        history=[turn.model_dump() for turn in payload.history],
    )
    return ok(result, "Assistant answered.")


@router.get("/audit-log")
async def get_assistant_audit_log(
    asked_by: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(require_permission("finance.ai_assistant.audit_log.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT l.id, l.asked_by, u.full_name AS asked_by_name, l.question, l.tool_calls,
                   l.answer, l.model, l.hit_tool_call_limit, l.error, l.created_at
            FROM finance.ai_assistant_query_log l
            LEFT JOIN core.users u ON u.id = l.asked_by
            WHERE l.organization_id = :org_id
              AND (CAST(:asked_by AS uuid) IS NULL OR l.asked_by = CAST(:asked_by AS uuid))
            ORDER BY l.created_at DESC
            LIMIT :limit
        """),
        {"org_id": user["org_id"], "asked_by": asked_by, "limit": limit},
    )
    items = [dict(r) for r in rows.mappings()]
    return ok(items, "Assistant audit log retrieved.", total=len(items))
