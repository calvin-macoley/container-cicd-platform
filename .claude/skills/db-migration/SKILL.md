---
name: db-migration
description: Use when changing SQLAlchemy models or creating Alembic migrations. Enforces migrations that are safe during canary releases.
---
# Database migrations

Old and new app versions run simultaneously during a canary, against the same
database. Every migration must work with BOTH the previous and the new code.

## Expand/contract rules
- Allowed in one release: add a nullable column, add a table, add an index
  (CONCURRENTLY on Postgres), add a column with a server default.
- Never in one release: drop or rename a column/table, change a column type,
  add NOT NULL to an existing column.
- Renames and drops are split across releases:
  1. Expand: add new column, write to both, read from old.
  2. Migrate: backfill, switch reads to new column.
  3. Contract (a later release): drop the old column.

## Steps
1. Change models in src/shortener/models.py.
2. Run `make migrate-new msg="<description>"` to autogenerate.
3. Review the generated file by hand; autogenerate misses renames and
   server defaults.
4. Ensure downgrade() is implemented and actually reverses upgrade().
5. Run upgrade, downgrade, upgrade against the test database to prove it.
6. State in the PR description which expand/contract phase this is.
