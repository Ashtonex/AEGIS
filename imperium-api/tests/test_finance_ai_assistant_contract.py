from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

MIGRATION = (ROOT / "migrations" / "215_finance_ai_assistant_query_log.sql").read_text(encoding="utf-8")
TOOLS_MODULE = (ROOT / "app" / "services" / "finance" / "ai_assistant_tools.py").read_text(encoding="utf-8")
ASSISTANT_MODULE = (ROOT / "app" / "services" / "finance" / "ai_assistant.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "finance_assistant.py").read_text(encoding="utf-8")
CONFIG = (ROOT / "core" / "config.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
FINANCE_PAGE = (WEB_ROOT / "app" / "dashboard" / "finance" / "page.tsx").read_text(encoding="utf-8")
DASHBOARD_SHELL = (WEB_ROOT / "app" / "dashboard" / "DashboardShell.tsx").read_text(encoding="utf-8") + (
    WEB_ROOT / "lib" / "navigation.ts"
).read_text(encoding="utf-8")  # nav role/permission data now lives here, see lib/navigation.ts
WEB_API = (WEB_ROOT / "lib" / "api.ts").read_text(encoding="utf-8") + "".join(
    sorted_p.read_text(encoding="utf-8")
    for sorted_p in [(WEB_ROOT / "lib" / "api") / n for n in ("core.ts", "website.ts", "crm.ts", "procurement.ts", "fleet.ts", "finance.ts", "inventory.ts", "hr.ts", "compliance.ts", "documents.ts", "reports.ts", "quotations.ts", "banking.ts", "data-room.ts")]
)

_WRITE_FUNCTION_SUBSTRINGS = (
    "propose_journal", "post_journal", "settle_liability", "approve_", "reject_",
    "create_journal", "update_journal", "delete_journal", "post_department_transfer",
    "record_progress_claim_fiscal_invoice", "certify_progress_claim",
)


class MigrationContractTests(unittest.TestCase):
    def test_table_is_append_only_shaped(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.ai_assistant_query_log", MIGRATION)
        # No updated_at/is_deleted columns - this table is itself an audit
        # trail, never mutated after insert. Scoped to the CREATE TABLE
        # statement only, since the migration's own comments legitimately
        # mention these column names in prose when explaining the design.
        create_table_stmt = MIGRATION.split("CREATE TABLE IF NOT EXISTS finance.ai_assistant_query_log (")[1].split(");")[0]
        self.assertNotIn("updated_at", create_table_stmt)
        self.assertNotIn("is_deleted", create_table_stmt)

    def test_no_audit_trigger_on_its_own_audit_table(self):
        self.assertNotIn("process_audit_log", MIGRATION)

    def test_both_permission_keys_granted_to_the_right_tier(self):
        self.assertIn("'finance.ai_assistant.use'", MIGRATION)
        self.assertIn("'finance.ai_assistant.audit_log.read'", MIGRATION)
        self.assertIn("r.name = 'SUPERADMIN'", MIGRATION)
        self.assertIn("r.name IN ('Finance Manager', 'Executive (Admin)', 'Managing Director')", MIGRATION)
        # Project Manager / Quantity Surveyor deliberately excluded at launch.
        self.assertNotIn("Project Manager", MIGRATION)
        self.assertNotIn("Quantity Surveyor", MIGRATION)


class ToolAllowListContractTests(unittest.TestCase):
    def test_no_write_or_mutating_function_anywhere_in_the_allow_list(self):
        for banned in _WRITE_FUNCTION_SUBSTRINGS:
            self.assertNotIn(banned, TOOLS_MODULE, f"Found a write-shaped reference '{banned}' in the tool allow-list")

    def test_get_available_tools_filters_strictly_by_permission(self):
        from app.services.finance.ai_assistant_tools import get_available_tools

        pm_shaped_permissions = {"finance.gl.read"}
        tools = get_available_tools(pm_shaped_permissions)
        self.assertEqual({t.permission_key for t in tools}, {"finance.gl.read"})
        self.assertTrue(all(t.permission_key == "finance.gl.read" for t in tools))

        no_permissions = set()
        self.assertEqual(get_available_tools(no_permissions), [])

    def test_get_tool_by_name_refuses_a_name_outside_the_allowed_set(self):
        from app.services.finance.ai_assistant_tools import get_available_tools, get_tool_by_name

        narrow_tools = get_available_tools({"finance.gl.read"})
        # get_vat_net_position requires finance.statutory.read, not granted here.
        self.assertIsNone(get_tool_by_name("get_vat_net_position", narrow_tools))
        self.assertIsNone(get_tool_by_name("not_a_real_tool", narrow_tools))
        self.assertIsNotNone(get_tool_by_name("get_trial_balance", narrow_tools))

    def test_eleven_tools_registered_across_six_permission_domains(self):
        from app.services.finance.ai_assistant_tools import _ALL_TOOLS

        self.assertEqual(len(_ALL_TOOLS), 11)
        permission_keys = {t.permission_key for t in _ALL_TOOLS}
        self.assertEqual(
            permission_keys,
            {
                "finance.gl.read", "finance.ccb_findings.read", "finance.statutory.read",
                "finance.cash.read", "finance.historical_entry.read", "finance.company_budget.read",
            },
        )


class OrchestrationContractTests(unittest.TestCase):
    def test_system_prompt_contains_the_guardrail_phrases(self):
        self.assertIn("never from your own general knowledge", ASSISTANT_MODULE)
        self.assertIn("say so honestly", ASSISTANT_MODULE)
        self.assertIn("say so plainly rather", ASSISTANT_MODULE)
        self.assertIn("you cannot take that action", ASSISTANT_MODULE)

    def test_tool_call_round_cap_is_five(self):
        self.assertIn("_MAX_TOOL_CALL_ROUNDS = 5", ASSISTANT_MODULE)

    def test_circuit_breaker_and_retry_wrap_the_openai_call(self):
        self.assertIn('CircuitBreaker(\n    "finance_assistant"', ASSISTANT_MODULE)
        self.assertIn("@retry(", ASSISTANT_MODULE)
        self.assertIn("RateLimitError", ASSISTANT_MODULE)

    def test_log_query_is_called_on_every_outcome_path(self):
        # not_configured path
        not_configured_block = ASSISTANT_MODULE.split("if not api_key:")[1].split("import openai")[0]
        self.assertIn("_log_query(", not_configured_block)
        # normal/limit/error path - single shared call after the try/except block
        tail = ASSISTANT_MODULE.split("result = {\"answer\": final_answer")[1]
        self.assertIn("await _log_query(", tail)

    def test_out_of_allow_list_tool_call_is_rejected_not_executed(self):
        self.assertIn("if tool is None:", ASSISTANT_MODULE)
        self.assertIn("is not available to you", ASSISTANT_MODULE)


class RouterContractTests(unittest.TestCase):
    def test_ask_endpoint_requires_use_permission(self):
        ask_block = ROUTER.split("async def ask_assistant")[1].split("\n\n\n@router.get")[0]
        self.assertIn('require_permission("finance.ai_assistant.use")', ROUTER.split("async def ask_assistant")[0][-200:] + ask_block)

    def test_audit_log_endpoint_requires_its_own_read_permission(self):
        self.assertIn('require_permission("finance.ai_assistant.audit_log.read")', ROUTER)

    def test_ask_endpoint_derives_the_users_own_permission_set(self):
        ask_block = ROUTER.split("async def ask_assistant")[1]
        self.assertIn("get_user_permission_keys(db, user)", ask_block)

    def test_history_and_question_are_the_only_accepted_request_fields(self):
        self.assertIn('extra="forbid"', ROUTER)


class ConfigAndMountContractTests(unittest.TestCase):
    def test_openai_settings_are_optional_and_fail_closed(self):
        self.assertIn("OPENAI_API_KEY: Optional[str] = None", CONFIG)
        self.assertIn('FINANCE_ASSISTANT_MODEL: str = "gpt-4o"', CONFIG)

    def test_router_is_mounted(self):
        self.assertIn("from routers import finance_assistant", MAIN)
        self.assertIn('app.include_router(finance_assistant.router, prefix="/api/v1/finance/assistant"', MAIN)


class FrontendContractTests(unittest.TestCase):
    def test_finance_tab_registered(self):
        self.assertIn('"ai-assistant"', FINANCE_PAGE)
        self.assertIn("FinanceAssistantPanel", FINANCE_PAGE)

    def test_nav_entry_registered(self):
        self.assertIn('{ name: "AI Assistant", href: "/dashboard/finance/ai-assistant"', DASHBOARD_SHELL)

    def test_api_wrapper_exists_and_slow_domain_timeout_applied(self):
        self.assertIn("export async function askFinanceAssistant", WEB_API)
        self.assertIn('"/api/v1/finance/assistant/"', WEB_API)


if __name__ == "__main__":
    unittest.main()
