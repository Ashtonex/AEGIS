"""Critical Path Method (CPM) and Project Scheduling Service.

Calculates Early Start (ES), Early Finish (EF), Late Start (LS), Late Finish (LF),
Total Float (TF), and Critical Path for project milestones/activities based on
durations and Finish-to-Start (FS) dependency relationships.
"""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class CyclicDependencyError(Exception):
    """Raised when a circular dependency is detected in the milestone schedule."""
    def __init__(self, cycle_nodes: list[str]):
        super().__init__(f"Circular dependency detected among milestones: {' -> '.join(cycle_nodes)}")
        self.cycle_nodes = cycle_nodes


def calculate_cpm_schedule(
    milestones: list[dict[str, Any]],
    dependencies: list[dict[str, Any]] | None = None,
    default_start_date: date | None = None,
) -> list[dict[str, Any]]:
    """Calculates CPM dates, float, and critical path for a list of milestones.

    Each milestone is expected to have:
      - 'id': str or UUID
      - 'name': str
      - 'duration_days': int (default 1)
      - 'baseline_date': Optional[date]
      - 'forecast_date': Optional[date]
      - 'predecessor_id': Optional[str or UUID]
      - 'lag_days': Optional[int] (default 0)
      - 'dependency_type': Optional[str] (default 'FS')

    Optional dependencies list can specify additional many-to-many links:
      - 'milestone_id': str or UUID
      - 'predecessor_id': str or UUID
      - 'lag_days': int
      - 'dependency_type': str ('FS', 'SS', 'FF', 'SF')
    """
    if not milestones:
        return []

    # Map milestone IDs to items
    node_map: dict[str, dict[str, Any]] = {}
    preds: dict[str, list[tuple[str, int, str]]] = defaultdict(list)
    succs: dict[str, list[tuple[str, int, str]]] = defaultdict(list)

    anchor_date = default_start_date or date.today()

    for m in milestones:
        mid = str(m["id"])
        dur = max(int(m.get("duration_days") or 1), 1)
        base_d = m.get("baseline_date")
        if isinstance(base_d, str):
            base_d = date.fromisoformat(base_d)
        fc_d = m.get("forecast_date")
        if isinstance(fc_d, str):
            fc_d = date.fromisoformat(fc_d)

        node_map[mid] = {
            **m,
            "id": mid,
            "duration_days": dur,
            "baseline_date": base_d,
            "forecast_date": fc_d,
            "early_start": None,
            "early_finish": None,
            "late_start": None,
            "late_finish": None,
            "total_float": 0,
            "is_critical": False,
        }

        # Handle direct predecessor_id on the milestone
        direct_pred = m.get("predecessor_id")
        if direct_pred:
            p_id = str(direct_pred)
            lag = int(m.get("lag_days") or 0)
            dep_type = str(m.get("dependency_type") or "FS").upper()
            preds[mid].append((p_id, lag, dep_type))
            succs[p_id].append((mid, lag, dep_type))

    # Incorporate extra dependencies from link table
    if dependencies:
        for dep in dependencies:
            mid = str(dep["milestone_id"])
            pid = str(dep["predecessor_id"])
            lag = int(dep.get("lag_days") or 0)
            dep_type = str(dep.get("dependency_type") or "FS").upper()
            if mid in node_map and pid in node_map:
                if not any(p[0] == pid for p in preds[mid]):
                    preds[mid].append((pid, lag, dep_type))
                    succs[pid].append((mid, lag, dep_type))

    # --- 1. Cycle Detection (Tarjan / Kahn's algorithm) ---
    in_degree: dict[str, int] = {mid: 0 for mid in node_map}
    for mid, pred_list in preds.items():
        # Only count predecessors that are actually in node_map
        valid_preds = [p for p in pred_list if p[0] in node_map]
        in_degree[mid] = len(valid_preds)

    queue = deque([mid for mid, deg in in_degree.items() if deg == 0])
    topo_order: list[str] = []

    while queue:
        curr = queue.popleft()
        topo_order.append(curr)
        for succ_id, _, _ in succs[curr]:
            if succ_id in in_degree:
                in_degree[succ_id] -= 1
                if in_degree[succ_id] == 0:
                    queue.append(succ_id)

    if len(topo_order) < len(node_map):
        unvisited = [mid for mid in node_map if mid not in topo_order]
        raise CyclicDependencyError(unvisited)

    # --- 2. Forward Pass: Early Start & Early Finish ---
    for mid in topo_order:
        node = node_map[mid]
        dur = node["duration_days"]
        valid_preds = [p for p in preds[mid] if p[0] in node_map]

        if not valid_preds:
            # Anchor to existing forecast_date, baseline_date, or default anchor
            es = node["forecast_date"] or node["baseline_date"] or anchor_date
        else:
            max_ef_pred: date | None = None
            for pid, lag, dep_type in valid_preds:
                pred_node = node_map[pid]
                pred_ef = pred_node["early_finish"] or anchor_date
                pred_es = pred_node["early_start"] or anchor_date

                if dep_type == "FS":  # Finish to Start
                    candidate = pred_ef + timedelta(days=lag)
                elif dep_type == "SS":  # Start to Start
                    candidate = pred_es + timedelta(days=lag)
                elif dep_type == "FF":  # Finish to Finish
                    candidate = pred_ef + timedelta(days=lag - dur)
                else:  # SF
                    candidate = pred_es + timedelta(days=lag - dur)

                if max_ef_pred is None or candidate > max_ef_pred:
                    max_ef_pred = candidate
            es = max_ef_pred or anchor_date

        ef = es + timedelta(days=dur)
        node["early_start"] = es
        node["early_finish"] = ef

    # Determine Project Completion Date
    all_efs = [node["early_finish"] for node in node_map.values() if node["early_finish"]]
    project_completion_date = max(all_efs) if all_efs else anchor_date

    # --- 3. Backward Pass: Late Finish & Late Start ---
    for mid in reversed(topo_order):
        node = node_map[mid]
        dur = node["duration_days"]
        valid_succs = [s for s in succs[mid] if s[0] in node_map]

        if not valid_succs:
            lf = project_completion_date
        else:
            min_ls_succ: date | None = None
            for sid, lag, dep_type in valid_succs:
                succ_node = node_map[sid]
                succ_ls = succ_node["late_start"] or project_completion_date
                succ_lf = succ_node["late_finish"] or project_completion_date

                if dep_type == "FS":
                    candidate = succ_ls - timedelta(days=lag)
                elif dep_type == "SS":
                    candidate = succ_ls - timedelta(days=lag - dur)
                elif dep_type == "FF":
                    candidate = succ_lf - timedelta(days=lag)
                else:  # SF
                    candidate = succ_lf - timedelta(days=lag + dur)

                if min_ls_succ is None or candidate < min_ls_succ:
                    min_ls_succ = candidate
            lf = min_ls_succ or project_completion_date

        ls = lf - timedelta(days=dur)
        node["late_finish"] = lf
        node["late_start"] = ls

        # --- 4. Total Float & Critical Path ---
        # Total Float = Late Start - Early Start (in days)
        tf = (ls - node["early_start"]).days
        node["total_float"] = tf
        node["is_critical"] = (tf <= 0)

        # Sync forecast_date with calculated early_finish if not set or for forecast tracking
        if not node.get("forecast_date"):
            node["forecast_date"] = ef

    return list(node_map.values())


async def recalculate_and_persist_project_cpm(
    db: AsyncSession,
    org_id: UUID | str,
    project_id: UUID | str,
) -> list[dict[str, Any]]:
    """Fetches all milestones and dependencies for a project, runs CPM,

    updates the database, and returns the enriched milestone list.
    """
    # Fetch milestones
    res = await db.execute(
        text("""
            SELECT id, name, status, baseline_date, forecast_date, actual_date,
                   weight, owner_id, notes, duration_days, predecessor_id,
                   lag_days, dependency_type, is_critical, total_float,
                   early_start, early_finish, late_start, late_finish
            FROM projects.project_milestones
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND is_deleted = false
            ORDER BY baseline_date NULLS LAST, created_at ASC
        """),
        {"org_id": str(org_id), "project_id": str(project_id)},
    )
    milestones = [dict(r) for r in res.mappings().all()]
    if not milestones:
        return []

    # Fetch extra dependencies
    dep_res = await db.execute(
        text("""
            SELECT milestone_id, predecessor_id, dependency_type, lag_days
            FROM projects.milestone_dependencies
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
        """),
        {"org_id": str(org_id), "project_id": str(project_id)},
    )
    dependencies = [dict(r) for r in dep_res.mappings().all()]

    # Fetch project start date for anchoring
    proj_res = await db.execute(
        text("SELECT start_date FROM projects.projects WHERE id = CAST(:project_id AS uuid)"),
        {"project_id": str(project_id)},
    )
    proj_row = proj_res.mappings().first()
    proj_start = proj_row.get("start_date") if proj_row else None

    # Run CPM
    cpm_results = calculate_cpm_schedule(
        milestones=milestones,
        dependencies=dependencies,
        default_start_date=proj_start,
    )

    # Persist calculated CPM fields back to database
    for m in cpm_results:
        await db.execute(
            text("""
                UPDATE projects.project_milestones SET
                    duration_days = :duration_days,
                    predecessor_id = CAST(:predecessor_id AS uuid),
                    lag_days = :lag_days,
                    dependency_type = :dependency_type,
                    is_critical = :is_critical,
                    total_float = :total_float,
                    early_start = :early_start,
                    early_finish = :early_finish,
                    late_start = :late_start,
                    late_finish = :late_finish,
                    forecast_date = COALESCE(:forecast_date, forecast_date),
                    updated_at = NOW()
                WHERE id = CAST(:id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND project_id = CAST(:project_id AS uuid)
            """),
            {
                "id": str(m["id"]),
                "org_id": str(org_id),
                "project_id": str(project_id),
                "duration_days": m["duration_days"],
                "predecessor_id": str(m["predecessor_id"]) if m.get("predecessor_id") else None,
                "lag_days": m.get("lag_days") or 0,
                "dependency_type": m.get("dependency_type") or "FS",
                "is_critical": bool(m["is_critical"]),
                "total_float": int(m["total_float"]),
                "early_start": m["early_start"],
                "early_finish": m["early_finish"],
                "late_start": m["late_start"],
                "late_finish": m["late_finish"],
                "forecast_date": m["forecast_date"],
            },
        )

    await db.commit()
    return cpm_results
