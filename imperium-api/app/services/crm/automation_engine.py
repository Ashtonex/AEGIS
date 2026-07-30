import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger
from app.shared.events import emit_notification, emit_role_notification


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {})


def conditions_match(conditions: Any, event: Dict[str, Any]) -> bool:
    if isinstance(conditions, str):
        try:
            conditions = json.loads(conditions)
        except json.JSONDecodeError:
            return False
    if not conditions:
        return True
    if isinstance(conditions, list):
        return all(conditions_match(condition, event) for condition in conditions)
    field = conditions.get("field")
    operator = conditions.get("operator", "equals")
    expected = conditions.get("value")
    if not field:
        return True
    actual = event.get(field)
    if operator in {"equals", "="}:
        return actual == expected
    if operator in {"not_equals", "!="}:
        return actual != expected
    if operator in {"greater_than", ">"}:
        return float(actual or 0) > float(expected or 0)
    if operator in {"less_than", "<"}:
        return float(actual or 0) < float(expected or 0)
    if operator == "contains":
        return str(expected).lower() in str(actual).lower()
    return False


async def execute_action(
    db: AsyncSession,
    org_id: str,
    user_id: Optional[str],
    rule: Dict[str, Any],
    event: Dict[str, Any],
    action_result: Dict[str, Any],
) -> None:
    actions = rule.get("actions")
    if isinstance(actions, str):
        actions = json.loads(actions)
    if isinstance(actions, list) and actions:
        first_action = actions[0]
        action_type = first_action.get("type") or first_action.get("action_type")
        action_config = first_action.get("config") or first_action.get("action_config") or {}
    else:
        action_type = rule.get("action_type")
        action_config = rule.get("action_config") or {}
    if isinstance(action_config, str):
        action_config = json.loads(action_config)
    action_result["action_type"] = action_type

    if action_type == "log_activity":
        await db.execute(
            text("""
                INSERT INTO crm.activities (organization_id, created_by, lead_id, opportunity_id, type, subject, description, status)
                VALUES (:org_id, :user_id, :lead_id, :opportunity_id, 'Task', :subject, :description, 'Pending')
                RETURNING id
            """),
            {
                "org_id": org_id,
                "user_id": user_id,
                "lead_id": event.get("lead_id"),
                "opportunity_id": event.get("opportunity_id"),
                "subject": action_config.get("subject", rule.get("name", "CRM automation task")),
                "description": action_config.get("description", ""),
            },
        )
        action_result["created"] = "activity"
    elif action_type == "create_ticket":
        ticket = await db.execute(
            text("""
                INSERT INTO crm.support_tickets (organization_id, created_by, subject, description, status, priority, contact_id, opportunity_id)
                VALUES (:org_id, :user_id, :subject, :description, 'new', :priority, :contact_id, :opportunity_id)
                RETURNING id
            """),
            {
                "org_id": org_id,
                "user_id": user_id,
                "subject": action_config.get("subject", rule.get("name", "Automated CRM ticket")),
                "description": action_config.get("description", ""),
                "priority": action_config.get("priority", "normal"),
                "contact_id": event.get("contact_id"),
                "opportunity_id": event.get("opportunity_id"),
            },
        )
        action_result["ticket_id"] = str(ticket.scalar())
    elif action_type == "update_opportunity_stage" and event.get("opportunity_id"):
        await db.execute(
            text("""
                UPDATE crm.opportunities
                SET stage = :stage, updated_at = NOW()
                WHERE id = :opportunity_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"stage": action_config.get("stage", "Qualification"), "opportunity_id": event["opportunity_id"], "org_id": org_id},
        )
        action_result["updated"] = "opportunity_stage"
    elif action_type == "assign_owner" and action_config.get("owner_user_id"):
        table = action_config.get("target_table")
        record_id = event.get("id") or event.get("lead_id") or event.get("opportunity_id") or event.get("ticket_id")
        if table in {"crm.leads", "crm.opportunities", "crm.support_tickets"} and record_id:
            owner_column = "assigned_to" if table in {"crm.leads", "crm.support_tickets"} else "owner_user_id"
            await db.execute(
                text(f"""
                    UPDATE {table}
                    SET {owner_column} = :owner_user_id, updated_at = NOW()
                    WHERE id = :record_id AND organization_id = :org_id AND is_deleted = false
                """),
                {"owner_user_id": action_config["owner_user_id"], "record_id": record_id, "org_id": org_id},
            )
            action_result["assigned_owner"] = action_config["owner_user_id"]
        else:
            action_result["recorded_only"] = True
    elif action_type == "escalate_ticket" and event.get("ticket_id") and action_config.get("owner_user_id"):
        await db.execute(
            text("""
                UPDATE crm.support_tickets
                SET escalated_at = NOW(), escalated_to = :owner_user_id, escalation_reason = :reason,
                    assigned_to = :owner_user_id, updated_at = NOW()
                WHERE id = :ticket_id AND organization_id = :org_id AND is_deleted = false
            """),
            {
                "owner_user_id": action_config["owner_user_id"],
                "reason": action_config.get("reason", "Automated escalation"),
                "ticket_id": event["ticket_id"],
                "org_id": org_id,
            },
        )
        action_result["escalated"] = True
    elif action_type == "send_notification":
        title = action_config.get("title") or rule.get("name") or "CRM automation alert"
        message = action_config.get("message") or f"Automation rule '{rule.get('name')}' fired."
        role_names = action_config.get("role_names") or []
        if role_names:
            count = await emit_role_notification(
                db, org_id=org_id, role_names=role_names, title=title, message=message,
                notification_type="crm_automation", priority=action_config.get("priority", "normal"),
            )
            action_result["notified_role_count"] = count
        elif action_config.get("user_id"):
            await emit_notification(
                db, org_id=org_id, user_id=action_config["user_id"], title=title, message=message,
                notification_type="crm_automation", priority=action_config.get("priority", "normal"),
            )
            action_result["notified_user_id"] = action_config["user_id"]
        else:
            action_result["recorded_only"] = True
            action_result["reason"] = "no user_id or role_names configured"
    elif action_type == "send_template_message":
        template = None
        if action_config.get("template_id"):
            template_row = await db.execute(
                text("SELECT * FROM crm.message_templates WHERE id = :template_id AND organization_id = :org_id AND is_deleted = false"),
                {"template_id": action_config["template_id"], "org_id": org_id},
            )
            template = template_row.mappings().first()
        if template:
            body = template["body"]
            for key, value in event.items():
                body = body.replace(f"{{{{{key}}}}}", str(value))
            comm = await db.execute(
                text("""
                    INSERT INTO crm.communication_events (
                        organization_id, created_by, actor_user_id, contact_id, lead_id, opportunity_id,
                        channel, direction, subject, body, status, template_id
                    )
                    VALUES (
                        :org_id, :user_id, :user_id, :contact_id, :lead_id, :opportunity_id,
                        :channel, 'outbound', :subject, :body, 'pending', :template_id
                    )
                    RETURNING id
                """),
                {
                    "org_id": org_id,
                    "user_id": user_id,
                    "contact_id": event.get("contact_id"),
                    "lead_id": event.get("lead_id"),
                    "opportunity_id": event.get("opportunity_id"),
                    "channel": template["channel"],
                    "subject": template.get("subject"),
                    "body": body,
                    "template_id": action_config["template_id"],
                },
            )
            action_result["communication_id"] = str(comm.scalar())
        else:
            action_result["recorded_only"] = True
            action_result["reason"] = "no template_id configured or template not found"
    else:
        action_result["recorded_only"] = True


async def evaluate_and_run_automations(
    db: AsyncSession,
    org_id: str,
    user_id: Optional[str],
    trigger_type: str,
    trigger_payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Find active automation_rules matching trigger_type, evaluate their conditions,
    execute the first matching action, and log every attempt (success/skip/failure)
    to crm.automation_runs so failures are auditable rather than silent."""
    rules_result = await db.execute(
        text("""
            SELECT * FROM crm.automation_rules
            WHERE organization_id = :org_id AND is_deleted = false AND is_active = true AND trigger_type = :trigger_type
            ORDER BY created_at ASC
            LIMIT 50
        """),
        {"org_id": org_id, "trigger_type": trigger_type},
    )
    rules = [dict(row._mapping) for row in rules_result]
    if not rules:
        return []

    runs: List[Dict[str, Any]] = []
    for rule in rules:
        status_value = "completed"
        action_result: Dict[str, Any] = {"dry_run": False}
        failure_reason = None
        try:
            conditions = rule.get("conditions") or rule.get("trigger_conditions") or {}
            if not conditions_match(conditions, trigger_payload):
                status_value = "skipped"
                action_result["reason"] = "conditions_not_met"
            else:
                await execute_action(db, org_id, user_id, rule, trigger_payload, action_result)
        except Exception as exc:  # pragma: no cover - defensive run logging
            status_value = "failed"
            failure_reason = str(exc)
            logger.warning(
                "Automation rule execution failed",
                rule_id=str(rule.get("id")),
                trigger_type=trigger_type,
                error=failure_reason,
            )
            # A failed action may have left the transaction aborted at the
            # database level. Roll back before issuing the audit INSERT
            # below, otherwise that INSERT itself fails and the failure
            # record (the whole point of this audit trail) is never written.
            await db.rollback()

        triggering_record_id = None
        for key in ("lead_id", "opportunity_id", "contact_id", "ticket_id", "id"):
            val = trigger_payload.get(key)
            if val:
                try:
                    triggering_record_id = str(UUID(str(val)))
                    break
                except ValueError:
                    pass

        run = await db.execute(
            text("""
                INSERT INTO crm.automation_runs (
                  organization_id, rule_id, automation_id, triggering_record_id,
                  trigger_type, input_payload, output_payload, trigger_payload, action_result,
                  status, error_message, failure_reason, finished_at, created_by
                )
                VALUES (
                  :org_id, :rule_id, :rule_id, :triggering_record_id,
                  :trigger_type, CAST(:trigger_payload AS jsonb), CAST(:action_result AS jsonb),
                  CAST(:trigger_payload AS jsonb), CAST(:action_result AS jsonb),
                  :status, :error_message, :error_message, NOW(), :user_id
                )
                RETURNING id
            """),
            {
                "org_id": org_id,
                "rule_id": str(rule["id"]),
                "triggering_record_id": triggering_record_id,
                "trigger_type": trigger_type,
                "trigger_payload": _json(trigger_payload),
                "action_result": _json(action_result),
                "status": "Failed" if status_value == "failed" else "Success",
                "error_message": failure_reason,
                "user_id": user_id,
            },
        )
        runs.append({"id": str(run.scalar()), "status": status_value, "rule_id": str(rule["id"])})

    await db.commit()
    return runs


async def fire_trigger(
    db: AsyncSession,
    org_id: str,
    user_id: Optional[str],
    trigger_type: str,
    trigger_payload: Dict[str, Any],
) -> None:
    """Best-effort inline trigger for use inside other routers right after a primary
    write commits. Automation failures must never break the caller's own request, so
    exceptions are logged and swallowed rather than propagated."""
    try:
        await evaluate_and_run_automations(db, org_id, user_id, trigger_type, trigger_payload)
    except Exception as exc:  # pragma: no cover - defensive, must not break the caller
        logger.warning("Inline automation trigger failed", trigger_type=trigger_type, error=str(exc))
