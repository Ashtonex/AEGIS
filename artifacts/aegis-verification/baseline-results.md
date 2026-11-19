# Baseline results (before any change, 2026-11-19)

Environment: Windows 11, Python 3.14.6 (`imperium-api/.venv`), Node 24.18.0. The sandbox copy of the
source had no `.env`. Settings came from `harness/sbxenv.sh` (dummy values; DB `127.0.0.1:55499`, Redis
`127.0.0.1:6399`, Supabase and HTTP(S) proxy `127.0.0.1:9`, all dead), and the `netguard` socket guard was
loaded with `-p netguard`.

| Check | Command | Exit | Duration | Result |
|---|---|---|---|---|
| Backend pytest (full) | `python -m pytest -q -p netguard -rfEs --durations=15` | 0 | 1,739 s | **1,726 passed, 0 failed, 30 skipped** (all skips need a Postgres opt-in, or the missing root `.env.example`), 15 subtests passed |
| Netguard (non-loopback attempts) | log file | — | — | **0** attempts recorded |
| Frontend unit tests (the CI set) | `node --experimental-strip-types --test src/components/procurement/{journey,materials,supplierOrders}.test.ts` | 0 | 1.1 s | 20 passed |
| Frontend typecheck | `npx tsc --noEmit -p tsconfig.json` (working tree, including the user's uncommitted edits) | 0 | 147 s | clean |
| Static route audit | `harness/route_audit.py` | 0 | ~60 s | 1,182 operations; 1,155 with an auth dependency, 27 without |

Not run: `npm run lint`, `next build`, the bundle budget, the `qa_*_suite.py` harnesses (these need a
live DB), and the Postgres opt-in tests.

Outlier: `tests/test_email_redirects.py::test_login_only_address_goes_to_its_real_mailbox` took
1,267.8 s in the baseline run (6.6 s alone). See F-03.
