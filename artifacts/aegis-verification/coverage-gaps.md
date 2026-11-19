# Coverage gaps (2026-11-19)

Measured: test counts and the route-level auth sweep only. **No statement or branch coverage was
measured.** `pytest-cov` is not in `requirements-dev.txt`, and nothing new was installed. Line coverage
would not prove correctness anyway.

| Gap | Why not covered | Risk | Next safe step |
|---|---|---|---|
| Authenticated business logic against real SQL (all `text()` queries, triggers, RLS, constraints) | No isolated database this run. The only configured DB is production, which was refused. | High: most defect classes in this repo historically are SQL and runtime (see `asyncpg-param-types`, `SYSTEM_REPAIR_REGISTER.md`) | Stand up a local PG17 replica from the repo's own migrations (or a read-only schema dump, with the owner's OK) and set the opt-in env for `test_*_postgres.py` |
| Valid-token HTTP paths (role A vs role B, tenant A vs tenant B) | Needs `core.users`/`roles`/`permissions` rows | High | Same replica, plus synthetic users and the HS256 test issuer (`JWT_ISSUER=aegis-ui-test`) |
| Concurrency, idempotency and lost-write behaviour on real Postgres | Same | Medium | Replica; reuse `CHK-009`-style `asyncio.gather` probes |
| Migrations apply cleanly from empty and roll forward | Same | Medium | `run_aegis_migrations.py` against the replica |
| Worker/queue redelivery, scheduled jobs | Not executed; reviewed only | Medium | Run the worker against the replica plus local Redis |
| Frontend build, lint, browser flows | Time budget; the build is memory-heavy on this machine | Medium | `npm run lint`, then `npx next build --webpack` separately (see memory note on build OOM) |
| External adapters (Supabase Auth live, Resend, Twilio, Graph, OpenAI, e-GP) | BLOCKED_EXTERNAL_DEPENDENCY | — | Mocked tests only |
| Deployment topology (F-04 proxy header trust) | Would require inspecting the production host | Medium | Owner checks that the droplet firewall exposes only Caddy, and Caddy's `trusted_proxies` |
| Performance and load | Not run (no representative DB) | — | — |
| Dependency vulnerability scan | No current advisory data was fetched (no network) | Unknown | `pip-audit` / `npm audit` with network, in CI |
| 30 skipped Postgres tests | Opt-in env not set (no isolated DB) | — | See first row |
| Order-dependent slowness (F-03 symptom) | Root cause of the 1,268 s run (pool/retry state left by earlier tests) not isolated | Low | `pytest -p no:randomly --durations` bisect |
