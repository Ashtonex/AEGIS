"""SharePoint destination routing rules (Phase 6/7).

Pure logic, no Graph/DB calls - keeps the "where does this document go"
decision testable in isolation from network/auth concerns. The actual
resolution of a module name to a live drive/item ID happens in
document_service.py via core.sharepoint_folder_map.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Top-level SharePoint library names, as specified for the SNC_Controlled_Data
# site. Organisation-configurable in principle (core.organisation_integrations
# .library_map is keyed by this same `module` value), but these are the
# defaults the setup wizard offers to map during "Select Document Libraries".
LIBRARY_DIRECTORS = "00_DIRECTORS"
LIBRARY_FINANCE = "01_FINANCE"
LIBRARY_COMMERCIAL_QS = "02_COMMERCIAL_QS"
LIBRARY_PROJECTS = "03_PROJECTS"
LIBRARY_PROCUREMENT_STORES = "04_PROCUREMENT_STORES"
LIBRARY_PLANT_EQUIPMENT = "05_PLANT_EQUIPMENT"
LIBRARY_HR_WORKFORCE = "06_HR_WORKFORCE"
LIBRARY_COMPLIANCE_HSE = "07_COMPLIANCE_HSE"
LIBRARY_TENDERS = "08_TENDERS"
LIBRARY_AUDIT_EVIDENCE = "09_AUDIT_EVIDENCE"
LIBRARY_ARCHIVE = "10_ARCHIVE"

# AEGIS module -> default SharePoint library. "directors" is deliberately
# excluded from this map: nothing routes there automatically (Phase 6 -
# confidential board material only goes to 00_DIRECTORS when a caller passes
# module="directors" explicitly AND the requesting user's AEGIS permissions
# already allow it, checked by document_service.py before this is consulted).
MODULE_LIBRARY_MAP: dict[str, str] = {
    "finance": LIBRARY_FINANCE,
    "invoice": LIBRARY_FINANCE,
    "payroll": LIBRARY_FINANCE,
    "boq": LIBRARY_COMMERCIAL_QS,
    "budget": LIBRARY_COMMERCIAL_QS,
    "valuation": LIBRARY_COMMERCIAL_QS,
    "quotation": LIBRARY_COMMERCIAL_QS,
    "project": LIBRARY_PROJECTS,
    "procurement": LIBRARY_PROCUREMENT_STORES,
    "inventory": LIBRARY_PROCUREMENT_STORES,
    "plant": LIBRARY_PLANT_EQUIPMENT,
    "fleet": LIBRARY_PLANT_EQUIPMENT,
    "hr": LIBRARY_HR_WORKFORCE,
    "workforce": LIBRARY_HR_WORKFORCE,
    "compliance": LIBRARY_COMPLIANCE_HSE,
    "hse": LIBRARY_COMPLIANCE_HSE,
    "tender": LIBRARY_TENDERS,
    "crm": LIBRARY_TENDERS,
    "audit": LIBRARY_AUDIT_EVIDENCE,
    "archive": LIBRARY_ARCHIVE,
    "directors": LIBRARY_DIRECTORS,
}

# Phase 7's standard per-project folder tree, created under
# 03_PROJECTS/{project_code} - {project_name}/ the first time a project's
# documents are touched.
PROJECT_FOLDER_TEMPLATE: list[str] = [
    "01 Contract",
    "02 Drawings",
    "03 Budget",
    "04 Procurement",
    "05 Site Reports",
    "06 Variations",
    "07 Valuations",
    "08 Photos",
    "09 Correspondence",
    "10 Completion",
]

RESTRICTED_CONFIDENTIALITY_LEVELS = {"restricted", "director_only"}


@dataclass
class RoutingDecision:
    library: str
    subfolder_segments: list[str]


class RoutingDenied(Exception):
    """Raised when a document's classification is not authorised for its
    requested destination - e.g. director-only material without an explicit,
    permission-checked module='directors' request."""


def resolve_library(module: str, *, confidentiality_level: str = "internal") -> str:
    module_key = module.strip().lower()
    library = MODULE_LIBRARY_MAP.get(module_key)
    if not library:
        raise RoutingDenied(f"No SharePoint routing rule for module '{module}'.")

    if library == LIBRARY_DIRECTORS and module_key != "directors":
        # Defends against a caller accidentally routing something to
        # Directors via confidentiality_level alone - Phase 6 requires an
        # explicit module='directors' request, checked upstream against the
        # uploader's own AEGIS permission, not inferred from a flag.
        raise RoutingDenied("00_DIRECTORS requires an explicit directors-module upload with director permissions.")

    if module_key != "directors" and confidentiality_level == "director_only":
        raise RoutingDenied(
            "confidentiality_level='director_only' documents must be uploaded via the directors module."
        )

    return library


def project_folder_path(project_code: str, project_name: str, subfolder: Optional[str] = None) -> list[str]:
    project_folder = f"{project_code} - {project_name}".strip(" -")
    segments = [project_folder]
    if subfolder:
        if subfolder not in PROJECT_FOLDER_TEMPLATE:
            raise RoutingDenied(f"'{subfolder}' is not a recognised project subfolder.")
        segments.append(subfolder)
    return segments
