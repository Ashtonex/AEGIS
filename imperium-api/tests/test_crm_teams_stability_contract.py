from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TEAMS_PAGE = (
    ROOT / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "teams" / "page.tsx"
).read_text(encoding="utf-8")


def test_crm_teams_workspace_partial_loads_auxiliary_sources():
    assert "Promise.allSettled([getTeams(), getAssignableUsers(), getCrmTasks({})])" in TEAMS_PAGE
    assert "Assignable users did not load; team membership controls are limited." in TEAMS_PAGE
    assert "CRM tasks did not load; workload and overdue counts may be incomplete." in TEAMS_PAGE
    assert "const [teamsRes, usersRes, tasksRes] = await Promise.all([" not in TEAMS_PAGE
