/**
 * Create links table.
 *
 * Expand/contract phase: expand (new table only; no existing code depends on it).
 *
 * Same DDL as the Python service's Alembic revision 0001, so a database created
 * by either implementation has an identical schema. A database already at
 * Alembic 0001 is adopted: the table is left as is and only recorded here.
 */

import { sql, type Kysely } from "kysely";

async function adoptedFromAlembic(db: Kysely<unknown>): Promise<boolean> {
  const { rows } = await sql<{ links: string | null; alembic: string | null }>`
    SELECT to_regclass('links')::text AS links, to_regclass('alembic_version')::text AS alembic
  `.execute(db);
  const { links, alembic } = rows[0] ?? { links: null, alembic: null };
  if (links === null) return false;
  if (alembic !== null) {
    const version = await sql<{ version_num: string }>`
      SELECT version_num FROM alembic_version
    `.execute(db);
    if (version.rows.some((row) => row.version_num === "0001")) return true;
  }
  throw new Error("table 'links' exists but was not created by Alembic revision 0001");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (await adoptedFromAlembic(db)) return;

  await sql`
    CREATE TABLE links (
      -- Surrogate key. GENERATED ALWAYS AS IDENTITY (not SERIAL) rejects
      -- manually supplied ids, so the sequence can never drift.
      id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
      -- Short code used in the public URL: generated (7 chars) or a custom
      -- alias (3-32 chars).
      code VARCHAR(32) NOT NULL,
      -- Redirect destination. TEXT because URLs have no useful fixed bound;
      -- the API caps them at 2048 characters.
      target_url TEXT NOT NULL,
      -- All timestamps are timezone-aware. The database sets created_at, so it
      -- doesn't depend on app clocks.
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
      -- NULL means the link never expires.
      expires_at TIMESTAMP WITH TIME ZONE,
      -- Incremented atomically in the redirect query (click_count + 1).
      click_count BIGINT DEFAULT 0 NOT NULL,
      -- NULL until the first redirect.
      last_clicked_at TIMESTAMP WITH TIME ZONE,
      CONSTRAINT ck_links_click_count_non_negative CHECK (click_count >= 0),
      CONSTRAINT pk_links PRIMARY KEY (id),
      -- Enforces alias uniqueness. The API relies on this constraint (not a
      -- read-before-insert) to return 409, so concurrent creates are safe.
      -- It also provides the index used for code lookups.
      CONSTRAINT uq_links_code UNIQUE (code)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE links`.execute(db);
}
