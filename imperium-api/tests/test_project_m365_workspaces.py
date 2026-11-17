"""Pure-logic checks for project workspaces in Microsoft 365: names that
SharePoint / Teams will accept, Team link parsing and the Site Diary file."""

import io
from datetime import date, datetime, timezone
from decimal import Decimal

from openpyxl import load_workbook

from app.services.microsoft import project_workspace as pw
from routers.integrations_microsoft import _team_id_from


def test_folder_name_uses_code_and_name_or_name_alone():
    assert pw.project_folder_name("TCT-2026-014", "Trout Beck Canopy Tour") == "TCT-2026-014 - Trout Beck Canopy Tour"
    assert pw.project_folder_name(None, "Willowton Group Civil works") == "Willowton Group Civil works"
    assert pw.project_folder_name("", "") == "Project"


def test_folder_name_strips_characters_sharepoint_rejects():
    name = pw.project_folder_name("A/B", 'Roof: "phase" 2?')
    for bad in '"*:<>?/\\|#%':
        assert bad not in name


def test_channel_name_is_teams_safe_and_short():
    name = pw._channel_name("TBTS4", "Troutbeck - Timeshares Units 9-12, block A & B / phase #2 extended scope")
    assert len(name) <= 50
    for bad in "~#%&*{}+/\\:<>?|'\",":
        assert bad not in name
    assert not name.startswith(("_", "."))
    assert not name.endswith(".")


def test_team_link_parsing():
    gid = "1b2c3d4e-0000-4a4a-8b8b-123456789abc"
    link = f"https://teams.microsoft.com/l/team/19%3aabc%40thread.tacv2/conversations?groupId={gid}&tenantId=x"
    assert _team_id_from(link) == gid
    assert _team_id_from(gid) == gid
    assert _team_id_from("") is None
    assert _team_id_from("not a team") is None
    assert _team_id_from("https://example.com/no-group") is None


def test_site_diary_has_one_row_per_report_and_formats():
    rows = [
        {
            "report_date": date(2026, 11, 16), "status": "submitted", "shift": "day", "people": 12,
            "labour_hours": Decimal("96"), "plant_hours": Decimal("6.5"), "fuel": Decimal("40"),
            "materials_value": Decimal("42.25"), "targets_done": 2, "targets_total": 3,
            "actual_work": "Platform 3 decking", "delays": "", "safety_notes": "Toolbox talk",
            "photos": 4, "dockets": 1,
        },
        {
            "report_date": date(2026, 11, 15), "status": "approved", "shift": "day", "people": 10,
            "labour_hours": 80, "plant_hours": 0, "fuel": 0, "materials_value": 0,
            "targets_done": 0, "targets_total": 0, "actual_work": None, "delays": None, "safety_notes": None,
            "photos": 0, "dockets": 0,
        },
    ]
    content = pw.build_diary("TCT - Canopy", rows, "https://sp/folder", datetime(2026, 11, 17, tzinfo=timezone.utc))
    wb = load_workbook(io.BytesIO(content))
    ws = wb["Site Diary"]
    assert [c.value for c in ws[1]] == pw.DIARY_HEADERS
    assert ws.max_row == 3
    assert ws["H2"].value == 42.25
    assert ws["I2"].value == "2 of 3"
    assert ws["I3"].value in ("", None)
    assert ws.protection.sheet is True


def test_diary_signature_changes_with_content():
    base = {
        "report_date": date(2026, 11, 16), "status": "draft", "shift": "day", "people": 1, "labour_hours": 8,
        "plant_hours": 0, "fuel": 0, "materials_value": 0, "targets_done": 0, "targets_total": 0,
        "actual_work": "a", "delays": "", "safety_notes": "", "photos": 0, "dockets": 0,
    }
    a = pw._diary_signature([base], "u")
    assert a == pw._diary_signature([dict(base)], "u")
    assert a != pw._diary_signature([{**base, "photos": 1}], "u")
