---
name: db-migration
description: Use when changing the database schema or creating Kysely migrations. Enforces migrations that are safe during canary releases.
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

## Steps (paths under app/server/)
1. Add src/migrations/NNNN_short_name.ts exporting `up` and `down`, written
   as plain SQL with Kysely's `sql` tag. Name constraints explicitly
   (pk_/uq_/ck_/fk_ prefixes, as in 0001).
2. Register it in `MIGRATIONS` in src/migrate.ts (order matters).
3. Update the row types in src/db.ts to match.
4. Ensure `down` actually reverses `up`.
5. Prove it against the test database: with TEST_DATABASE_URL set, run
   `npm run test -w server`; extend tests/integration/migrations.int.test.ts
   to cover the new schema.
6. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, and all
   pending migrations run in one; ask before adding one.
7. State in the PR description which expand/contract phase this is.
