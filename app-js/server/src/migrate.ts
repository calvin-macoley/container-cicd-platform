/**
 * Database migrations: `node dist/migrate.js [up|down]`.
 *
 * `up` (the default) applies every pending migration; `down` reverts the
 * latest one (development only). Only DATABASE_URL is needed. Run it once per
 * release, before the new version starts serving traffic. Logs JSON to stdout.
 *
 * Concurrent jobs are safe: Kysely takes a PostgreSQL advisory lock, so a
 * second job waits for the first, then finds nothing to do. All pending
 * migrations run in one transaction.
 *
 * Exit codes: 0 = success, 1 = migration failed, 2 = bad arguments,
 * 78 = invalid configuration.
 */

import { pathToFileURL } from "node:url";

import { Kysely, PostgresDialect, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

import { ConfigError, loadDbSettings, type DbSettings } from "./config.js";
import { buildPool } from "./db.js";
import { child, createLogger, type Logger } from "./logging.js";
import * as m0001 from "./migrations/0001_create_links.js";

const EXIT_CONFIG_ERROR = 78;

/** Every migration, in order. Listed explicitly so the compiled image needs no file scanning. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  "0001_create_links": m0001,
};

export type Direction = "up" | "down";

/**
 * A DDL statement that cannot get its table lock within this time fails instead
 * of queueing all live traffic on that table behind it. Retry the job later.
 */
export const MIGRATION_LOCK_TIMEOUT = "5s";

/** Run each step with the lock timeout. SET LOCAL lasts until the migration transaction ends. */
function withLockTimeout(migration: Migration): Migration {
  const step =
    (fn: Migration["up"]) =>
    async (db: Kysely<unknown>): Promise<void> => {
      await sql`SET LOCAL lock_timeout = ${sql.lit(MIGRATION_LOCK_TIMEOUT)}`.execute(db);
      await fn(db);
    };
  return { up: step(migration.up), ...(migration.down && { down: step(migration.down) }) };
}

export async function migrate(
  settings: DbSettings,
  direction: Direction = "up",
  {
    migrations = MIGRATIONS,
    logger,
  }: { migrations?: Record<string, Migration>; logger?: Logger } = {},
): Promise<void> {
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: buildPool(settings) }) });
  const wrapped = Object.fromEntries(
    Object.entries(migrations).map(([name, migration]) => [name, withLockTimeout(migration)]),
  );
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(wrapped) },
  });
  try {
    const { error, results } =
      direction === "up" ? await migrator.migrateToLatest() : await migrator.migrateDown();
    for (const result of results ?? []) {
      logger?.info(
        { migration: result.migrationName, direction: result.direction, status: result.status },
        "migration",
      );
    }
    if (results?.length === 0) logger?.info({ direction }, "nothing to migrate");
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

async function main(argv: string[], logger: Logger): Promise<number> {
  const direction = argv[0] ?? "up";
  if (direction !== "up" && direction !== "down") {
    logger.error({ argument: direction }, "usage: migrate [up|down]");
    return 2;
  }
  let settings: DbSettings;
  try {
    settings = loadDbSettings();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.fatal(error.message);
      return EXIT_CONFIG_ERROR;
    }
    throw error;
  }
  try {
    await migrate(settings, direction, { logger });
    return 0;
  } catch (error) {
    logger.error({ exc_info: error }, "migration failed");
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const logger = child(createLogger("INFO"), "migrate");
  const code = await main(process.argv.slice(2), logger);
  logger.flush(() => process.exit(code));
}
