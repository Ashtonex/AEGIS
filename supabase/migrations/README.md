# Not the deployment migration path

These files are historical/local-Supabase-CLI scaffolding. Nothing in this
repo's CI or deploy pipeline reads this directory — `supabase/config.toml`
is standard `supabase init` boilerplate, not a wired-up production path.

The authoritative migration corpus is `imperium-api/migrations/`, applied by
`imperium-api/migrations/run_aegis_migrations.py` (see
`docs/SECURITY_ARCHITECTURE.md` and `docs/PYTHON_STACK_AUDIT.md`, both of
which call the raw-SQL runner over that directory authoritative).

Through 2026-09-13 most migrations were hand-duplicated into both
directories; that stopped being kept up as of the 2026-09 performance audit
remediation. **New migrations should only be added to
`imperium-api/migrations/`.** This folder is left in place rather than
deleted in case it's still used for local `supabase start` development, but
it is not kept in sync going forward.
