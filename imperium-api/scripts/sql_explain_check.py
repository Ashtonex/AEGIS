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
DYNAMIC_REAL_STATES = {"42703", "42883"}  # undefined column / undefined function


def _filler(preceding: str) -> str | None:
    """Stand-in for an interpolated f-string piece, chosen from the SQL before it."""
    tail = preceding.rstrip().upper()
    if tail.endswith(("WHERE", "AND", "OR", "ON", "HAVING", "(")):
        return "TRUE"
    if tail.endswith(("ORDER BY", "GROUP BY")):
        return "1"
    if tail.endswith(("SELECT", ",")):
        return "NULL"
    if tail.endswith(("SET", "FROM", "JOIN", "INTO", "UPDATE", "TABLE")):
        return None  # interpolated identifiers/assignments: cannot be planned
    return ""  # optional clause fragments ({where_sql}, {limit_sql}, ...)


def _literal(node):
    """Return (sql, dynamic) for a string literal, or (None, True) if unplannable."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value, False
    if isinstance(node, ast.JoinedStr):
        out = ""
        for value in node.values:
            if isinstance(value, ast.Constant):
                out += value.value
                continue
            filler = _filler(out)
            if filler is None:
                return None, True
            out += f" {filler} "
        return out, True
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        (left, dl), (right, dr) = _literal(node.left), _literal(node.right)
        if left is not None and right is not None:
            return left + right, dl or dr
    return None, True


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
            sql, is_dynamic = _literal(node.args[0])
            if sql is None:
                dynamic += 1
                continue
            if re.search(r"\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b", sql, re.I):
                statements.append((str(path.relative_to(ROOT)).replace("\\", "/"), node.lineno, sql, is_dynamic))
    return statements, dynamic


def substitute_params(sql: str) -> str:
    sql = re.sub(r"(?<![:\w]):[A-Za-z_]\w*", "NULL", sql)
    sql = re.sub(r"\bANY\s*\(\s*NULL\s*\)", "ANY('{}')", sql, flags=re.I)
    sql = re.sub(r"\bIN\s+NULL\b", "IN (NULL)", sql, flags=re.I)
    sql = re.sub(r"\bINTERVAL\s+NULL\b", "NULL::interval", sql, flags=re.I)
    return sql.strip().rstrip(";")


WORKERS = 6


async def _open(dsn: str):
    """A connection inside a READ ONLY transaction holding savepoint ``chk``."""
    import asyncpg

    conn = await asyncpg.connect(dsn, statement_cache_size=0, command_timeout=30)
    await conn.execute("BEGIN READ ONLY")
    await conn.execute("SAVEPOINT chk")
    return conn


async def _close(conn) -> None:
    try:
        await conn.execute("ROLLBACK")
    except Exception:  # noqa: BLE001 - connection may already be gone
        pass
    finally:
        await conn.close()


async def _check_chunk(dsn: str, chunk, failures, progress) -> None:
    """Plan each statement with a lone EXPLAIN (one round trip).

    A successful EXPLAIN changes nothing, so the single savepoint stays valid; a
    failure aborts the transaction and ``ROLLBACK TO SAVEPOINT`` restores it
    (keeping the savepoint for the next statement). Everything is rolled back
    at the end. Statements are sent alone because a parse error rejects an
    entire multi-statement message.
    """
    import asyncpg

    conn = await _open(dsn)
    try:
        for file, line, raw, is_dynamic in chunk:
            sql = substitute_params(raw)
            if re.search(r"\bANALYZE\b", sql, re.I) or ";" in sql:
                failures.append({"file": file, "line": line, "state": "SKIP", "error": "multi-statement or ANALYZE; not checked"})
                continue
            try:
                await conn.execute("EXPLAIN\n" + sql)
            except asyncpg.PostgresError as exc:
                failures.append({
                    "file": file, "line": line, "state": exc.sqlstate or "?",
                    "error": str(exc).splitlines()[0][:300], "dynamic": is_dynamic,
                })
                try:
                    await conn.execute("ROLLBACK TO SAVEPOINT chk")
                except Exception:  # noqa: BLE001 - start over on a fresh connection
                    await _close(conn)
                    conn = await _open(dsn)
            progress[0] += 1
            if progress[0] % 250 == 0:
                print(f"  ... {progress[0]} planned", flush=True)
    finally:
        await _close(conn)


async def main() -> int:
    from core.config import settings

    # Same transaction-pooler endpoint the app uses (core/database.py).
    dsn = settings.DATABASE_URL.replace(":5432/", ":6543/").replace("postgresql+asyncpg://", "postgresql://")
    statements, dynamic = extract_statements()
    print(f"Planning {len(statements)} statements on {WORKERS} connections ...", flush=True)
    failures, progress = [], [0]
    chunks = [statements[i::WORKERS] for i in range(WORKERS)]
    await asyncio.gather(*(_check_chunk(dsn, chunk, failures, progress) for chunk in chunks))
    failures.sort(key=lambda f: (f["file"], f["line"]))

    # For f-string SQL only an unknown column/function is unambiguous; anything
    # else may come from the stand-in text used for the interpolated pieces.
    real = [
        f for f in failures
        if f["state"] not in PARAM_ARTEFACT_STATES and f["state"] != "SKIP"
        and (not f.get("dynamic") or f["state"] in DYNAMIC_REAL_STATES)
    ]
    artefacts = [f for f in failures if f not in real]
    if "--json" in sys.argv:
        print(json.dumps({"checked": len(statements), "dynamic_skipped": dynamic, "failures": real, "artefacts": artefacts}))
    else:
        fstrings = sum(1 for stmt in statements if stmt[3])
        print(f"Checked {len(statements)} statements, {fstrings} of them f-string SQL ({dynamic} more could not be planned statically).")
        print(f"FAILURES: {len(real)}")
        for f in real:
            print(f"  {f['file']}:{f['line']}  [{f['state']}]  {f['error']}")
        print(f"Possible parameter-substitution artefacts / skipped: {len(artefacts)}")
        for f in artefacts:
            print(f"  {f['file']}:{f['line']}  [{f['state']}]  {f['error']}")
    return 1 if real else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
