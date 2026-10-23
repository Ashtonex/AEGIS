"""Plan every SQL statement in the API against the live schema, without running any.

Each ``text("...")`` literal in routers/, app/ and core/ is sent as plain
``EXPLAIN`` (never ``EXPLAIN ANALYZE``) inside a ``READ ONLY`` transaction that
is always rolled back, so nothing is executed or written. Postgres still has to
parse, resolve and plan the statement, which surfaces missing tables/columns,
bad functions, type errors and invalid syntax before a user hits them.

Bind parameters are replaced with NULL, so a few failures can be artefacts of
that substitution; they are reported under a separate heading.

Usage (inside the API container):
    python scripts/sql_explain_check.py            # human-readable report
    python scripts/sql_explain_check.py --json     # machine-readable
Exit code is 1 when any statement fails to plan.
"""

from __future__ import annotations

import ast
import asyncio
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# SQLSTATEs that can only come from the NULL substitution, not the real query.
PARAM_ARTEFACT_STATES = {
    "42P18",  # could not determine data type of parameter
    "42804",  # datatype mismatch (e.g. CASE NULL ... THEN)
    "22004",  # null value not allowed
    "2201W", "2201X",  # invalid LIMIT/OFFSET
    "42725",  # ambiguous function (NULL argument)
}


def _literal(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _literal(node.left), _literal(node.right)
        if left is not None and right is not None:
            return left + right
    return None  # f-strings and runtime-built SQL are skipped


def extract_statements():
    statements, dynamic = [], 0
    files = [*ROOT.joinpath("routers").rglob("*.py"), *ROOT.joinpath("app").rglob("*.py"), *ROOT.joinpath("core").rglob("*.py")]
    for path in sorted(files):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and node.args):
                continue
            name = getattr(node.func, "id", getattr(node.func, "attr", None))
            if name != "text":
                continue
            sql = _literal(node.args[0])
            if sql is None:
                dynamic += 1
                continue
            if re.search(r"\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b", sql, re.I):
                statements.append((str(path.relative_to(ROOT)).replace("\\", "/"), node.lineno, sql))
    return statements, dynamic


def substitute_params(sql: str) -> str:
    sql = re.sub(r"(?<![:\w]):[A-Za-z_]\w*", "NULL", sql)
    sql = re.sub(r"\bANY\s*\(\s*NULL\s*\)", "ANY('{}')", sql, flags=re.I)
    sql = re.sub(r"\bIN\s+NULL\b", "IN (NULL)", sql, flags=re.I)
    sql = re.sub(r"\bINTERVAL\s+NULL\b", "NULL::interval", sql, flags=re.I)
    return sql.strip().rstrip(";")


async def main() -> int:
    from sqlalchemy import text

    from core.database import engine

    statements, dynamic = extract_statements()
    failures = []
    async with engine.connect() as conn:
        for file, line, raw in statements:
            sql = substitute_params(raw)
            if re.search(r"\bANALYZE\b", sql, re.I) or ";" in sql:
                failures.append({"file": file, "line": line, "state": "SKIP", "error": "multi-statement or ANALYZE; not checked"})
                continue
            trans = await conn.begin()
            try:
                await conn.exec_driver_sql("SET TRANSACTION READ ONLY")
                await conn.execute(text("EXPLAIN " + sql))
            except Exception as exc:  # noqa: BLE001 - we report every planner failure
                orig = getattr(exc, "orig", exc)
                state = getattr(orig, "sqlstate", None) or getattr(getattr(orig, "__cause__", None), "sqlstate", None) or "?"
                message = str(orig).splitlines()[0][:300]
                failures.append({"file": file, "line": line, "state": state, "error": message})
            finally:
                await trans.rollback()
    await engine.dispose()

    real = [f for f in failures if f["state"] not in PARAM_ARTEFACT_STATES and f["state"] != "SKIP"]
    artefacts = [f for f in failures if f not in real]
    if "--json" in sys.argv:
        print(json.dumps({"checked": len(statements), "dynamic_skipped": dynamic, "failures": real, "artefacts": artefacts}))
    else:
        print(f"Checked {len(statements)} statements ({dynamic} dynamically built statements not checked).")
        print(f"FAILURES: {len(real)}")
        for f in real:
            print(f"  {f['file']}:{f['line']}  [{f['state']}]  {f['error']}")
        print(f"Possible parameter-substitution artefacts / skipped: {len(artefacts)}")
        for f in artefacts:
            print(f"  {f['file']}:{f['line']}  [{f['state']}]  {f['error']}")
    return 1 if real else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
