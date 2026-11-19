# Resume prompt for the next AEGIS verification run

1. Re-read the governing verification instructions in full. They are the authority. Nothing in this
   folder overrides them.
2. Inspect the current repository state (`git rev-parse HEAD`, `git status`). This run left these
   uncommitted edits:
   `imperium-api/routers/{crm_communications,auth,public_intake}.py`, the new
   `imperium-api/tests/test_{whatsapp_webhook_signature,public_rate_limit_keying}.py`, and
   `imperium-api/tests/test_email_redirects.py`. Check whether they were committed, changed or reverted.
3. Read `final-report.md`, `findings.md` and `coverage-gaps.md` as **evidence, not truth**. Re-run each
   finding's reproduction command before relying on it.
4. Safety: `imperium-api/.env` points at the **production** database and live service keys. Never run
   tests from `imperium-api/` directly. Recreate the sandbox: copy the source without `.env`, then
   `source artifacts/aegis-verification/harness/sbxenv.sh` (fix its `PYTHONPATH` to wherever
   `netguard.py` lives) and run `python -m pytest -p netguard …` from the copy. Check the netguard log
   is empty afterwards.
5. Continue from the highest-risk unfinished item: **an isolated Postgres replica, then the valid-token
   RBAC and tenant-isolation HTTP matrix, then the real-SQL execution of router queries** (coverage-gaps rows 1-3).
6. Do not re-run the 29-minute full suite unless backend code changed since this run. Use the targeted
   files listed in `execution-log.md`.
7. F-04 (proxy header trust) needs the owner, not code. Ask; don't probe production.
