"""Safe helpers for the small amount of dynamic SQL this codebase still needs."""

from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy import TextClause, text

_SQL_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
_SQL_TABLE = re.compile(r"^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$")
RESERVED_MUTATION_COLUMNS: frozenset[str] = frozenset(
    {
        "id",
        "created_at",
        "updated_at",
        "organization_id",
        "created_by",
        "is_deleted",
    }
)


def safe_table_name(table: str, allowed_tables: Iterable[str]) -> str:
    allowed = frozenset(allowed_tables)
    if table not in allowed or not _SQL_TABLE.fullmatch(table):
        raise ValueError(f"Unsafe SQL table identifier: {table!r}")
    return table


def safe_columns(columns: Iterable[str], allowed_columns: Iterable[str]) -> list[str]:
    requested = list(columns)
    allowed = frozenset(allowed_columns)
    safe = [
        column
        for column in requested
        if column in allowed and _SQL_IDENTIFIER.fullmatch(column)
    ]
    if len(safe) != len(requested):
        raise ValueError("Unsafe SQL column identifier.")
    return safe


def safe_payload_columns(
    payload_keys: Iterable[str],
    *,
    reserved_columns: Iterable[str] = RESERVED_MUTATION_COLUMNS,
) -> list[str]:
    reserved = frozenset(reserved_columns)
    safe = []
    for column in payload_keys:
        if column in reserved:
            continue
        if not _SQL_IDENTIFIER.fullmatch(column):
            raise ValueError(f"Unsafe SQL column identifier: {column!r}")
        safe.append(column)
    return safe


def insert_returning_id_sql(
    table: str,
    columns: Iterable[str],
    allowed_columns: Iterable[str],
    *,
    include_audit_columns: bool = True,
) -> TextClause:
    safe_table = safe_table_name(table, {table})
    safe = safe_columns(columns, allowed_columns)
    bind_names = [f":{column}" for column in safe]
    if include_audit_columns:
        safe = [*safe, "organization_id", "created_by"]
        bind_names = [*bind_names, ":org_id", ":user_id"]
    column_sql = ", ".join(safe)
    bind_sql = ", ".join(bind_names)
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        INSERT INTO {safe_table} ({column_sql})
        VALUES ({bind_sql})
        RETURNING id
        """  # nosec B608
    )


def update_returning_id_sql(
    table: str,
    columns: Iterable[str],
    allowed_columns: Iterable[str],
) -> TextClause:
    safe_table = safe_table_name(table, {table})
    safe = safe_columns(columns, allowed_columns)
    set_sql = ", ".join(f"{column} = :{column}" for column in safe)
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        UPDATE {safe_table}
        SET {set_sql}, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
        """  # nosec B608
    )


def update_tenant_row_sql(
    table: str,
    columns: Iterable[str],
    allowed_columns: Iterable[str],
    *,
    id_param: str = "item_id",
    require_not_deleted: bool = True,
    returning_id: bool = False,
    casts: dict[str, str] | None = None,
) -> TextClause:
    safe_table = safe_table_name(table, {table})
    safe = safe_columns(columns, allowed_columns)
    safe_id_param = safe_columns([id_param], [id_param])[0]
    cast_map = casts or {}
    set_sql = ", ".join(
        f"{column} = CAST(:{column} AS {cast_map[column]})"
        if column in cast_map
        else f"{column} = :{column}"
        for column in safe
    )
    deletion_filter = " AND is_deleted = false" if require_not_deleted else ""
    returning_sql = " RETURNING id" if returning_id else ""
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        UPDATE {safe_table}
        SET {set_sql}, updated_at = NOW()
        WHERE id = :{safe_id_param}
          AND organization_id = :org_id{deletion_filter}{returning_sql}
        """  # nosec B608
    )


def tenant_reference_sql(table: str, allowed_tables: Iterable[str]) -> TextClause:
    safe_table = safe_table_name(table, allowed_tables)
    # Table identifier is allowlist-validated above.
    return text(
        f"""
        SELECT 1 FROM {safe_table}
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """  # nosec B608
    )


def tenant_child_reference_sql(
    table: str,
    parent_column: str,
    allowed_tables: Iterable[str],
    allowed_parent_columns: Iterable[str],
) -> TextClause:
    safe_table = safe_table_name(table, allowed_tables)
    safe_parent = safe_columns([parent_column], allowed_parent_columns)[0]
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        SELECT 1 FROM {safe_table}
        WHERE id = :id
          AND {safe_parent} = :parent_id
          AND organization_id = :org_id
          AND is_deleted = false
        """  # nosec B608
    )


def tenant_child_rows_sql(
    table: str,
    order_column: str,
    allowed_tables: Iterable[str],
    allowed_order_columns: Iterable[str],
) -> TextClause:
    safe_table = safe_table_name(table, allowed_tables)
    safe_order = safe_columns([order_column], allowed_order_columns)[0]
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        SELECT *
        FROM {safe_table}
        WHERE fleet_id = :fleet_id
          AND organization_id = :org_id
          AND is_deleted = false
        ORDER BY {safe_order} DESC
        LIMIT 100
        """  # nosec B608
    )


def tenant_relation_summary_sql(
    table: str,
    allowed_tables: Iterable[str],
) -> TextClause:
    safe_table = safe_table_name(table, allowed_tables)
    # Table identifier is allowlist-validated above.
    return text(
        f"""
        SELECT COUNT(*) AS record_count, MAX(updated_at) AS last_updated
        FROM {safe_table}
        WHERE organization_id = :org_id AND is_deleted = false
        """  # nosec B608
    )


def tenant_child_rows_by_parent_sql(
    table: str,
    parent_column: str,
    order_column: str,
    allowed_tables: Iterable[str],
    allowed_parent_columns: Iterable[str],
    allowed_order_columns: Iterable[str],
) -> TextClause:
    safe_table = safe_table_name(table, allowed_tables)
    safe_parent = safe_columns([parent_column], allowed_parent_columns)[0]
    safe_order = safe_columns([order_column], allowed_order_columns)[0]
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        SELECT *
        FROM {safe_table}
        WHERE {safe_parent} = :parent_id
          AND organization_id = :org_id
          AND is_deleted = false
        ORDER BY {safe_order}
        """  # nosec B608
    )


def tenant_upsert_sql(
    table: str,
    columns: Iterable[str],
    allowed_columns: Iterable[str],
    *,
    base_columns: Iterable[str],
    conflict_target: str,
    casts: dict[str, str] | None = None,
    returning_columns: Iterable[str] = (),
    touch_profile_completed_at: bool = False,
) -> TextClause:
    safe_table = safe_table_name(table, {table})
    safe_columns_to_write = safe_columns(columns, allowed_columns)
    safe_base_columns = safe_columns(base_columns, base_columns)
    safe_conflict = safe_columns([conflict_target], [conflict_target])[0]
    safe_returning = safe_columns(returning_columns, returning_columns)
    cast_map = casts or {}

    all_columns = [*safe_base_columns, *safe_columns_to_write]
    value_binds = []
    for column in all_columns:
        bind = f":{column}"
        if column in cast_map:
            bind = f"CAST({bind} AS {cast_map[column]})"
        value_binds.append(bind)
    assignments = []
    for column in safe_columns_to_write:
        if column in cast_map:
            assignments.append(f"{column} = CAST(EXCLUDED.{column} AS {cast_map[column]})")
        else:
            assignments.append(f"{column} = EXCLUDED.{column}")
    if touch_profile_completed_at:
        all_columns.append("profile_completed_at")
        value_binds.append("NOW()")
        assignments.append("profile_completed_at = NOW()")
    assignments.append("updated_at = NOW()")
    returning_sql = f" RETURNING {', '.join(safe_returning)}" if safe_returning else ""
    # Table and column identifiers are allowlist-validated above.
    return text(
        f"""
        INSERT INTO {safe_table} ({", ".join(all_columns)})
        VALUES ({", ".join(value_binds)})
        ON CONFLICT ({safe_conflict}) DO UPDATE SET {", ".join(assignments)}
        {returning_sql}
        """  # nosec B608
    )
