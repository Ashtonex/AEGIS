from __future__ import annotations

import importlib


APPROVED_IMPORTS = {
    "fastapi": "FastAPI",
    "uvicorn": "Uvicorn",
    "pydantic": "Pydantic",
    "pydantic_settings": "Pydantic Settings",
    "email_validator": "email-validator",
    "httpx": "HTTPX",
    "multipart": "python-multipart",
    "sqlalchemy": "SQLAlchemy",
    "alembic": "Alembic",
    "asyncpg": "Asyncpg PostgreSQL driver",
    "redis": "redis-py",
    "arq": "Arq",
    "argon2": "argon2-cffi",
    "jwt": "PyJWT",
    "cryptography": "cryptography",
    "structlog": "structlog",
    "loguru": "legacy Loguru compatibility",
    "pandas": "pandas",
    "numpy": "NumPy",
    "openpyxl": "OpenPyXL",
    "xlsxwriter": "XlsxWriter",
    "reportlab": "ReportLab",
    "fitz": "PyMuPDF",
    "pypdf": "pypdf",
    "pdfplumber": "pdfplumber",
    "docx": "python-docx",
    "PIL": "Pillow",
    "defusedxml": "defusedxml",
    "bleach": "bleach",
    "puremagic": "puremagic file-signature detection",
    "pytest": "pytest",
    "pytest_asyncio": "pytest-asyncio",
    "hypothesis": "Hypothesis",
    "ruff": "Ruff",
    "mypy": "mypy",
    "bandit": "Bandit",
    "pip_audit": "pip-audit",
    "detect_secrets": "detect-secrets",  # pragma: allowlist secret
}


def main() -> int:
    failures: list[str] = []
    for module_name, label in APPROVED_IMPORTS.items():
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:
            failures.append(f"{label} ({module_name}): {type(exc).__name__}: {exc}")
            continue
        version = getattr(module, "__version__", "unknown")
        print(f"OK {label}: {module_name} {version}")

    if failures:
        print("\nMissing or broken imports:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print(f"\nVerified {len(APPROVED_IMPORTS)} approved package imports.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
