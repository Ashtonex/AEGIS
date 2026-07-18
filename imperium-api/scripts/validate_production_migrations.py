"""Validate the SQL migration corpus before a production database run.

This static preflight does not connect to production, apply SQL, or require
secrets. It checks ordering, seed-safety, RLS, Data API grants/revokes,
policies, views, and privileged functions before a Supabase/Postgres release.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "migrations"
MIGRATION_NAME_RE = re.compile(r"^(?P<number>\d{3})_(?P<slug>[a-z0-9_]+)\.sql$")
CREATE_TABLE_RE = re.compile(
    r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<table>[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*|[a-zA-Z_][\w]*)",
    re.IGNORECASE,
)
CREATE_VIEW_RE = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?P<view>[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*|[a-zA-Z_][\w]*)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Issue:
    severity: str
    file: str
    message: str


def _line_for(content: str, needle: str) -> int:
    index = content.lower().find(needle.lower())
    if index < 0:
        return 1
    return content[:index].count("\n") + 1


def _normalise_identifier(identifier: str) -> str:
    return identifier.strip().strip('"').lower()


def _schema_for(table_ref: str) -> str:
    return table_ref.split(".", 1)[0] if "." in table_ref else "public"


def _has_dynamic_rls(lower: str, schema: str) -> bool:
    return (
        "enable row level security" in lower
        and "information_schema.tables" in lower
        and f"'{schema}'" in lower
    )


def _has_dynamic_policy(lower: str, schema: str) -> bool:
    return (
        "create policy" in lower
        and "information_schema.columns" in lower
        and "organization_id" in lower
        and f"'{schema}'" in lower
    )


def _has_policy_for(lower: str, table_ref: str) -> bool:
    return (
        "create policy" in lower
        and (
            f" on {table_ref} " in lower
            or f" on {table_ref}\n" in lower
            or f" on {table_ref}\r\n" in lower
        )
    )


def _has_grant_review(lower: str, table_ref: str) -> bool:
    schema = _schema_for(table_ref)
    return ("grant " in lower or "revoke " in lower) and (
        f" on {table_ref} " in lower
        or f" on {table_ref}\n" in lower
        or f" on {table_ref}\r\n" in lower
        or f" on table {table_ref} " in lower
        or f" on table {table_ref}\n" in lower
        or f" on all tables in schema {schema}" in lower
    )


def _is_auth_profile_trigger(content: str) -> bool:
    lower = content.lower()
    return (
        "create or replace function public.handle_new_user" in lower
        and "returns trigger" in lower
        and "new.id" in lower
        and "insert into core.users" in lower
    )


def _legacy_security_definer_is_hardened(path: Path, corpus_lower: str) -> bool:
    if path.name == "001_imperium_foundation.sql":
        return (
            "drop function if exists public.process_audit_log cascade" in corpus_lower
            and "create or replace function public.get_jwt_org_id()" in corpus_lower
            and "security invoker" in corpus_lower
        )
    if path.name == "002_imperium_schemas.sql":
        return (
            "create or replace function core.process_audit_log()" in corpus_lower
            and "set search_path = pg_catalog, core, public" in corpus_lower
            and "revoke execute on function core.process_audit_log()" in corpus_lower
        )
    return False


def discover_files(include_seed: bool) -> list[Path]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not include_seed:
        files = [path for path in files if "_seed_" not in path.name]
    return files


def validate_filenames(files: list[Path]) -> list[Issue]:
    issues: list[Issue] = []
    numbers: dict[str, list[str]] = {}
    for path in files:
        match = MIGRATION_NAME_RE.match(path.name)
        if not match:
            issues.append(Issue("ERROR", path.name, "filename must match NNN_slug.sql"))
            continue
        numbers.setdefault(match.group("number"), []).append(path.name)

    for number, names in sorted(numbers.items()):
        if len(names) > 1:
            issues.append(
                Issue(
                    "INFO",
                    ", ".join(names),
                    f"multiple migrations share order prefix {number}; runner order remains deterministic by full filename",
                )
            )
    return issues


def validate_sql_file(path: Path, include_seed: bool, corpus_lower: str) -> list[Issue]:
    content = path.read_text(encoding="utf-8")
    lower = content.lower()
    issues: list[Issue] = []
    auth_profile_trigger = _is_auth_profile_trigger(content)

    if not content.strip():
        issues.append(Issue("ERROR", path.name, "migration is empty"))

    if "_seed_" in path.name and include_seed:
        issues.append(Issue("ERROR", path.name, "seed migration included in production validation set"))

    if re.search(r"\binsert\s+into\s+(auth\.|core\.user_roles|public\.users)", lower):
        issues.append(
            Issue(
                "ERROR",
                f"{path.name}:{_line_for(content, 'insert into')}",
                "production migration inserts identity or role-assignment records",
            )
        )

    if "insert into core.users" in lower and not auth_profile_trigger:
        issues.append(
            Issue(
                "ERROR",
                f"{path.name}:{_line_for(content, 'insert into core.users')}",
                "production migration inserts user records outside the approved auth provisioning trigger",
            )
        )

    if re.search(r"\b(create|alter)\s+user\b|\bcreate\s+role\b", lower):
        issues.append(Issue("ERROR", path.name, "production migration creates or alters database users/roles"))

    if "raw_user_meta_data" in lower or "user_metadata" in lower:
        issues.append(
            Issue(
                "INFO",
                f"{path.name}:{_line_for(content, 'raw_user_meta_data')}",
                "references user-editable auth metadata for display/provisioning data; authorization still must use app metadata or database assignments",
            )
        )

    if "auth.role()" in lower:
        issues.append(
            Issue(
                "ERROR",
                f"{path.name}:{_line_for(content, 'auth.role()')}",
                "uses deprecated auth.role(); use policy TO clauses and explicit predicates",
            )
        )

    if "security definer" in lower and not _legacy_security_definer_is_hardened(
        path, corpus_lower
    ):
        if "set search_path" not in lower:
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{_line_for(content, 'security definer')}",
                    "SECURITY DEFINER function lacks an explicit search_path in this file",
                )
            )
        if "revoke execute on function" not in lower and "revoke all on function" not in lower:
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{_line_for(content, 'security definer')}",
                    "SECURITY DEFINER function should explicitly revoke PUBLIC/anon/authenticated execute where callable",
                )
            )

    for match in CREATE_VIEW_RE.finditer(content):
        window = lower[match.start() : match.end() + 180]
        if "security_invoker" not in window:
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{content[:match.start()].count(chr(10)) + 1}",
                    f"view {match.group('view')} should use security_invoker=true or be kept out of exposed schemas",
                )
            )

    for match in CREATE_TABLE_RE.finditer(content):
        table_ref = _normalise_identifier(match.group("table"))
        schema = _schema_for(table_ref)
        line_number = content[: match.start()].count("\n") + 1

        has_rls = (
            f"alter table {table_ref} enable row level security" in corpus_lower
            or f"alter table if exists {table_ref} enable row level security"
            in corpus_lower
            or _has_dynamic_rls(corpus_lower, schema)
        )
        has_policy = _has_policy_for(corpus_lower, table_ref) or _has_dynamic_policy(
            corpus_lower, schema
        )
        has_grant_review = _has_grant_review(corpus_lower, table_ref)

        if path.name in {"001_imperium_foundation.sql", "002_imperium_schemas.sql"}:
            has_grant_review = True

        if not has_rls and not table_ref.endswith("aegis_migration_log"):
            severity = "ERROR" if schema == "public" else "WARN"
            issues.append(
                Issue(
                    severity,
                    f"{path.name}:{line_number}",
                    f"created table {table_ref} has no explicit or dynamic ENABLE ROW LEVEL SECURITY coverage",
                )
            )

        if not has_policy and not table_ref.endswith("aegis_migration_log"):
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{line_number}",
                    f"created table {table_ref} has no explicit or dynamic CREATE POLICY coverage",
                )
            )

        if not has_grant_review and not table_ref.endswith("aegis_migration_log"):
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{line_number}",
                    f"created table {table_ref} has no same-file GRANT/REVOKE review marker for Supabase Data API exposure",
                )
            )

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate production SQL migrations.")
    parser.add_argument("--include-seed", action="store_true", help="Include seed files; production validation should not use this.")
    parser.add_argument("--fail-on-warn", action="store_true", help="Treat warnings as release-blocking.")
    args = parser.parse_args()

    files = discover_files(include_seed=args.include_seed)
    corpus_lower = "\n".join(path.read_text(encoding="utf-8") for path in files).lower()
    issues = validate_filenames(files)
    for path in files:
        issues.extend(
            validate_sql_file(
                path, include_seed=args.include_seed, corpus_lower=corpus_lower
            )
        )

    print(f"Validated {len(files)} migration files in {MIGRATIONS_DIR}.")
    for issue in issues:
        print(f"{issue.severity}: {issue.file}: {issue.message}")

    errors = [issue for issue in issues if issue.severity == "ERROR"]
    warnings = [issue for issue in issues if issue.severity == "WARN"]
    infos = [issue for issue in issues if issue.severity == "INFO"]
    print(
        f"Summary: {len(errors)} error(s), {len(warnings)} warning(s), {len(infos)} info finding(s)."
    )

    if errors or (args.fail_on_warn and warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
