# AEGIS Dependency Security Report

Date: 2026-07-17

## Runtime Stack

| Package | Version | Purpose | Action |
| --- | ---: | --- | --- |
| FastAPI | 0.139.0 | API runtime | Kept and pinned |
| Pydantic / pydantic-settings | 2.13.4 / 2.14.2 | Validation and typed settings | Kept and pinned |
| SQLAlchemy / asyncpg | 2.0.51 / 0.31.0 | Async PostgreSQL access | Kept and pinned |
| Alembic | 1.18.5 | Migration compatibility tooling | Kept and pinned |
| redis / Arq | 5.3.1 / 0.28.0 | Redis and async workers | Kept and pinned |
| argon2-cffi | 25.1.0 | Password hashing | Kept and pinned |
| PyJWT / cryptography | 2.13.0 / 49.0.0 | Token and crypto support | Kept and pinned |
| structlog | 25.5.0 | Structured application logging | Added and integrated |
| ReportLab / PyMuPDF | 5.0.0 / 1.28.0 | PDF generation and extraction | Kept and pinned |
| pypdf / pdfplumber / python-docx | 6.14.2 / 0.11.10 / 1.2.0 | Document operations | Added, upgraded after audit, and pinned |
| defusedxml / bleach / puremagic | 0.7.1 / 6.4.0 / 1.30 | Document and input safety | Added, upgraded after audit, and pinned |

## Development And Assurance Stack

| Package | Version | Purpose | Action |
| --- | ---: | --- | --- |
| pytest / pytest-asyncio / pytest-cov | 9.1.1 / 1.4.0 / 7.1.0 | Test execution and coverage | Kept and pinned |
| Hypothesis | 6.136.9 | Property-based boundary tests | Added and pinned |
| Ruff | 0.15.22 | Linting | Kept and pinned |
| mypy | 2.3.0 | Type checking | Kept and pinned |
| Bandit | 1.8.6 | Static security scanning | Added and pinned |
| pip-audit | 2.9.0 | Dependency vulnerability scanning | Added and pinned |
| detect-secrets | 1.5.0 | Secret scanning | Added and pinned |

## Decisions

`python-jose`, Passlib, Celery, Django, Flask, SQLModel and MongoDB are not part of the approved core stack. `puremagic` is the selected Windows-compatible file-signature detector instead of native `python-magic`.

`loguru` remains pinned temporarily for compatibility with existing lockfile history, but the active logging façade now uses `structlog`.

## Verification

The required package import check is executable through:

```powershell
..\venv\Scripts\python.exe scripts\verify_dependency_imports.py
```

Security scan commands are documented in `docs/SECURITY_OPERATIONS.md`.

Latest dependency audit result: `pip-audit -r requirements.txt` returned no known vulnerabilities after upgrading `pypdf`, `bleach`, `pdfminer.six` and `pdfplumber`.

Latest scoped secret scan result: no findings in source, docs and configuration placeholders.

Bandit result: the scanner runs with documented temporary exclusions for pre-existing `B608` and `B110` findings. Full unfiltered Bandit currently reports no high-severity findings, but it does report medium/low hardening debt in generated dynamic SQL and silent cleanup handlers.
