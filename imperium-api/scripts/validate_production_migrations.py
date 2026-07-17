"""Validate the SQL migration corpus before a production database run.

This is intentionally a static preflight: it does not connect to production,
does not apply SQL, and does not need secrets. It catches ordering, seed-safety,
RLS, grants/revokes, policy, and privileged-function risks that should be
reviewed before running migrations against Supabase/Postgres.
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


def _normalise_table(identifier: str) -> str:
    return identifier.strip().strip('"').lower()


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
                    "WARN",
                    ", ".join(names),
                    f"multiple production migrations share order prefix {number}; execution is lexicographic but review before release",
                )
            )
    return issues


def validate_sql_file(path: Path, include_seed: bool) -> list[Issue]:
    content = path.read_text(encoding="utf-8")
    lower = content.lower()
    issues: list[Issue] = []

    if path.name.endswith(".sql") and not content.strip():
        issues.append(Issue("ERROR", path.name, "migration is empty"))

    if "_seed_" in path.name and include_seed:
        issues.append(Issue("ERROR", path.name, "seed migration included in production validation set"))

    if re.search(r"\binsert\s+into\s+(auth\.|core\.users|core\.user_roles|public\.users)", lower):
        issues.append(
            Issue(
                "ERROR",
                f"{path.name}:{_line_for(content, 'insert into')}",
                "production migration inserts identity, user, or role-assignment records",
            )
        )

    if re.search(r"\b(create|alter)\s+user\b|\bcreate\s+role\b", lower):
        issues.append(
            Issue(
                "ERROR",
                path.name,
                "production migration creates or alters database users/roles",
            )
        )

    if "raw_user_meta_data" in lower or "user_metadata" in lower:
        severity = "ERROR" if "_seed_" not in path.name else "WARN"
        issues.append(
            Issue(
                severity,
                f"{path.name}:{_line_for(content, 'raw_user_meta_data')}",
                "references user-editable auth metadata; do not use it for authorization decisions",
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

    if "security definer" in lower:
        if "set search_path" not in lower and "set search_path =" not in lower:
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
        window = lower[match.start() : match.end() + 160]
        if "security_invoker" not in window:
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{content[:match.start()].count(chr(10)) + 1}",
                    f"view {match.group('view')} should use security_invoker=true or be kept out of exposed schemas",
                )
            )

    created_tables = [`n        (`n            _normalise_table(match.group("table")),`n            content[: match.start()].count("\n") + 1,`n        )`n        for match in CREATE_TABLE_RE.finditer(content)`n    ]`n    for table, line_number in created_tables:
        if "." not in table:
            table_ref = table
        else:
            table_ref = table

        rls_patterns = [
            f"alter table {table_ref} enable row level security",
            f"alter table if exists {table_ref} enable row level security",
        ]
        has_rls = any(pattern in lower for pattern in rls_patterns)
        has_policy = f" on {table_ref} " in lower and "create policy" in lower
        has_revoke_or_grant = (
            f" on {table_ref} " in lower
            or f" on all tables in schema {table_ref.split('.')[0]}" in lower
        ) and ("revoke " in lower or "grant " in lower)

        if table_ref.startswith("public.") or "." not in table_ref:
            severity = "ERROR"
        else:
            severity = "WARN"

        if not has_rls and not table_ref.endswith("aegis_migration_log"):
            issues.append(
                Issue(
                    severity,
                    f"{path.name}:{line_number}",
                    f"created table {table_ref} has no explicit ENABLE ROW LEVEL SECURITY in the same migration",
                )
            )

        if not has_policy and not table_ref.endswith("aegis_migration_log"):
            issues.append(
                Issue(
                    "WARN",
                    f"{path.name}:{line_number}",
                    f"created table {table_ref} has no same-file CREATE POLICY reference",
                )
            )

        if not has_revoke_or_grant and not table_ref.endswith("aegis_migration_log"):
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
    issues = validate_filenames(files)
    for path in files:
        issues.extend(validate_sql_file(path, include_seed=args.include_seed))

    print(f"Validated {len(files)} migration files in {MIGRATIONS_DIR}.")
    for issue in issues:
        print(f"{issue.severity}: {issue.file}: {issue.message}")

    errors = [issue for issue in issues if issue.severity == "ERROR"]
    warnings = [issue for issue in issues if issue.severity == "WARN"]
    print(f"Summary: {len(errors)} error(s), {len(warnings)} warning(s).")

    if errors or (args.fail_on_warn and warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

