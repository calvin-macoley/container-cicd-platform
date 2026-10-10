/** Migrations are reversible, produce the documented schema, and adopt Alembic databases. */

import { Kysely, PostgresDialect, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPool } from "../../src/db.js";
import { MIGRATIONS, migrate } from "../../src/migrate.js";
import { hasTestDatabase, testDbSettings } from "./db.js";

describe.skipIf(!hasTestDatabase)("migrations", () => {
  let db: Kysely<unknown>;

  beforeAll(() => {
    if (!testDbSettings) throw new Error("unreachable: suite is skipped");
    db = new Kysely({ dialect: new PostgresDialect({ pool: buildPool(testDbSettings) }) });
  });
  afterAll(async () => {
    // Leave the database migrated for the other suites.
    if (testDbSettings) await migrate(testDbSettings, "up");
    await db.destroy();
  });

  const settings = () => {
    if (!testDbSettings) throw new Error("unreachable: suite is skipped");
    return testDbSettings;
  };
  const hasTable = async (name: string) =>
    (await sql<{ t: string | null }>`SELECT to_regclass(${name})::text AS t`.execute(db)).rows[0]
      ?.t != null;
  const resetToEmpty = async () => {
    await sql`DROP TABLE IF EXISTS links, alembic_version, kysely_migration, kysely_migration_lock`.execute(
      db,
    );
  };

  it("upgrades, downgrades and upgrades again", async () => {
    await resetToEmpty();
    await migrate(settings(), "up");
    expect(await hasTable("links")).toBe(true);

    await migrate(settings(), "down");
    expect(await hasTable("links")).toBe(false);

    await migrate(settings(), "up");
    expect(await hasTable("links")).toBe(true);
  });

  it("creates the schema the Python service's Alembic 0001 creates", async () => {
    await resetToEmpty();
    await migrate(settings(), "up");

    const columns = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      character_maximum_length: number | null;
      is_identity: string;
      identity_generation: string | null;
      column_default: string | null;
    }>`
      SELECT column_name, data_type, is_nullable, character_maximum_length,
             is_identity, identity_generation, column_default
      FROM information_schema.columns
      WHERE table_name = 'links'
      ORDER BY ordinal_position
    `.execute(db);
    expect(columns.rows).toEqual([
      expect.objectContaining({
        column_name: "id",
        data_type: "bigint",
        is_nullable: "NO",
        is_identity: "YES",
        identity_generation: "ALWAYS",
      }),
      expect.objectContaining({
        column_name: "code",
        data_type: "character varying",
        character_maximum_length: 32,
        is_nullable: "NO",
      }),
      expect.objectContaining({ column_name: "target_url", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({
        column_name: "created_at",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
        column_default: "now()",
      }),
      expect.objectContaining({
        column_name: "expires_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      }),
      expect.objectContaining({
        column_name: "click_count",
        data_type: "bigint",
        is_nullable: "NO",
        column_default: "0",
      }),
      expect.objectContaining({
        column_name: "last_clicked_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      }),
    ]);

    const constraints = await sql<{ conname: string }>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'links'::regclass AND contype IN ('c', 'f', 'p', 'u')
      ORDER BY conname
    `.execute(db);
    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "ck_links_click_count_non_negative",
      "pk_links",
      "uq_links_code",
    ]);
  });

  it("adopts a database already at Alembic revision 0001", async () => {
    await resetToEmpty();
    // Simulate the Python service's database: table plus Alembic's bookkeeping.
    await migrate(settings(), "up");
    await sql`DROP TABLE kysely_migration, kysely_migration_lock`.execute(db);
    await sql`CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)`.execute(db);
    await sql`INSERT INTO alembic_version VALUES ('0001')`.execute(db);
    await sql`INSERT INTO links (code, target_url) VALUES ('kept1', 'https://example.com/')`.execute(
      db,
    );

    await migrate(settings(), "up");

    const kept = await sql<{ code: string }>`SELECT code FROM links`.execute(db);
    expect(kept.rows).toEqual([{ code: "kept1" }]);
  });

  it("runs every migration with a 5 s lock timeout", async () => {
    await resetToEmpty();
    const seen: string[] = [];
    const probe = {
      up: async (trx: Kysely<unknown>) => {
        const { rows } = await sql<{
          t: string;
        }>`SELECT current_setting('lock_timeout') AS t`.execute(trx);
        seen.push(rows[0]?.t ?? "");
      },
    };

    await migrate(settings(), "up", { migrations: { ...MIGRATIONS, "9999_probe": probe } });

    expect(seen).toEqual(["5s"]);
    // Scoped to the migration transaction: other sessions keep the server default.
    const after = await sql<{ t: string }>`SELECT current_setting('lock_timeout') AS t`.execute(db);
    expect(after.rows[0]?.t).not.toBe("5s");
    await resetToEmpty();
  });

  it("refuses an unknown pre-existing links table", async () => {
    await resetToEmpty();
    await sql`CREATE TABLE links (id int)`.execute(db);

    await expect(migrate(settings(), "up")).rejects.toThrow("not created by Alembic");
    await resetToEmpty();
  });
});
