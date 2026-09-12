"""
AI Financial Control Assistant (Phase 10B) - orchestration loop.

Read/explain-only by construction: the only "tools" the model can call are
the ones in ai_assistant_tools.py, filtered to the caller's own
permissions, and every returned tool-call name is re-validated against
that same filtered set before it is ever executed. There is no write tool
anywhere in the allow-list, so there is no code path by which this
assistant can delete, approve, post, or settle anything - it can only
read and summarize data that already exists.

Every call is logged to finance.ai_assistant_query_log (question, the
tool calls made, the final answer) regardless of outcome - including a
hit tool-call-limit or an error - so what the assistant was asked and
what it surfaced stays reviewable, matching the module docstring's own
audit intent.

Conversation state is not persisted server-side: the caller resends prior
turns as `history` on each request (see routers/finance_assistant.py).
This keeps the feature's footprint to a single new table, consistent with
every other phase in this initiative's "narrowest coherent slice"
precedent, at the cost of not remembering conversations across sessions -
a deliberate, documented trade-off, not an oversight.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.services.finance.ai_assistant_tools import get_available_tools, get_tool_by_name
from core.config import settings
from core.resilience import CircuitBreaker

logger = logging.getLogger(__name__)

_MAX_TOOL_CALL_ROUNDS = 5

_finance_assistant_breaker = CircuitBreaker(
    "finance_assistant", failure_threshold=5, reset_timeout_seconds=60.0
)

_SYSTEM_PROMPT = (
    "You are the AI Financial Control Assistant for a construction company's finance system. "
    "You are strictly read-only and explain-only: you have no ability to delete, approve, post, "
    "settle, or invent anything, and you must never claim otherwise. "
    "Only state a figure, status, or fact if it came from a tool call result in this conversation - "
    "never from your own general knowledge or assumption. If a tool result is null, marked as a "
    "fallback, or shows 'no baseline'/'not configured', say so honestly rather than rounding it to "
    "zero or guessing a value. If no available tool can answer the question, say so plainly rather "
    "than answering anyway. If asked to approve, post, reject, settle, delete, or otherwise change "
    "anything, explain clearly that you cannot take that action and point the user to the correct "
    "screen in the app to do it themselves - never attempt it, and never pretend you did it. "
    "When you do answer from tool data, briefly note which data you consulted."
)


class AssistantNotConfiguredError(Exception):
    pass


async def _log_query(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    question: str,
    tool_calls: list,
    answer: Optional[str],
    model: Optional[str],
    hit_tool_call_limit: bool,
    error: Optional[str],
) -> None:
    await db.execute(
        text("""
            INSERT INTO finance.ai_assistant_query_log (
                organization_id, asked_by, question, tool_calls, answer,
                model, hit_tool_call_limit, error
            ) VALUES (
                :org_id, :asked_by, :question, CAST(:tool_calls AS jsonb), :answer,
                :model, :hit_tool_call_limit, :error
            )
        """),
        {
            "org_id": org_id,
            "asked_by": user_id,
            "question": question,
            "tool_calls": json.dumps(tool_calls, default=str),
            "answer": answer,
            "model": model,
            "hit_tool_call_limit": hit_tool_call_limit,
            "error": error,
        },
    )
    await db.commit()


async def answer_question(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    user_permissions: set,
    question: str,
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    api_key = settings.OPENAI_API_KEY or os.getenv("OPENAI_API_KEY")
    if not api_key:
        result = {
            "answer": "The AI Financial Control Assistant is not configured yet (OPENAI_API_KEY is not set). Please contact an administrator.",
            "tool_calls": [],
            "hit_tool_call_limit": False,
        }
        await _log_query(
            db, org_id=org_id, user_id=user_id, question=question, tool_calls=[],
            answer=result["answer"], model=None, hit_tool_call_limit=False,
            error="not_configured",
        )
        return result

    import openai

    allowed_tools = get_available_tools(user_permissions)
    tool_schemas = [t.to_openai_schema() for t in allowed_tools]

    messages: List[Dict[str, Any]] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for turn in (history or [])[-20:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": question})

    model = settings.FINANCE_ASSISTANT_MODEL
    tool_call_log: list = []
    hit_limit = False
    error: Optional[str] = None
    final_answer: Optional[str] = None

    @retry(
        retry=retry_if_exception_type(
            (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)
        ),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    async def _call_openai():
        client = openai.AsyncOpenAI(api_key=api_key)
        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": 0.1,
            "timeout": 45.0,
        }
        if tool_schemas:
            kwargs["tools"] = tool_schemas
            kwargs["tool_choice"] = "auto"
        return await client.chat.completions.create(**kwargs)

    try:
        for _round in range(_MAX_TOOL_CALL_ROUNDS):
            response = await _finance_assistant_breaker.call_async(_call_openai)
            choice = response.choices[0]
            message = choice.message

            if not message.tool_calls:
                final_answer = message.content or "I wasn't able to produce an answer for that."
                break

            messages.append({
                "role": "assistant",
                "content": message.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in message.tool_calls
                ],
            })

            for tool_call in message.tool_calls:
                name = tool_call.function.name
                try:
                    args = json.loads(tool_call.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}

                tool = get_tool_by_name(name, allowed_tools)
                if tool is None:
                    tool_result: Any = {
                        "error": f"Tool '{name}' is not available to you - either it doesn't exist or you don't have permission for the underlying data."
                    }
                else:
                    try:
                        tool_result = await tool.fn(db, org_id, **args)
                    except Exception as exc:
                        logger.warning(f"Finance assistant tool '{name}' failed: {exc}")
                        tool_result = {"error": f"That lookup failed: {exc}"}

                tool_call_log.append({"name": name, "arguments": args})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(tool_result, default=str),
                })
        else:
            hit_limit = True
            final_answer = (
                "I wasn't able to fully answer this within the allowed number of lookups - "
                "try narrowing the question (e.g. to one project, account, or period)."
            )
    except Exception as exc:
        logger.warning(f"Finance assistant call failed: {exc}")
        error = str(exc)
        final_answer = "Something went wrong answering that question. Please try again shortly."

    result = {"answer": final_answer, "tool_calls": tool_call_log, "hit_tool_call_limit": hit_limit}
    await _log_query(
        db, org_id=org_id, user_id=user_id, question=question, tool_calls=tool_call_log,
        answer=final_answer, model=model, hit_tool_call_limit=hit_limit, error=error,
    )
    return result
