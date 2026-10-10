/**
 * Helpers for tests against a real PostgreSQL at TEST_DATABASE_URL.
 *
 * Tests never use DATABASE_URL: it may name a real development database, and
 * integration tests truncate and drop tables. DATABASE_URL is read only to
 * refuse a TEST_DATABASE_URL that points at the same database. When
 * TEST_DATABASE_URL is unset, integration suites skip.
 */

import { sql } from "kysely";

import { createApp } from "../../src/app.js";
import { loadDbSettings, type DbSettings, type Settings } from "../../src/config.js";
import { Database } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { SqlLinkRepository } from "../../src/repository.js";
import { captureLogger, makeSettings } from "../helpers.js";

export class TestDatabaseConfigError extends Error {
  override name = "TestDatabaseConfigError";
}

function databaseKey(url: string): string {
  try {
    const parsed = new URL(url.replace(/^[a-z+]+:\/\//, "postgresql://"));
    return `${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.slice(1)}`;
  } catch {
    return url;
  }
}

/** DbSettings for TEST_DATABASE_URL, or null when it is not set. */
export function resolveTestDbSettings(
  env: Readonly<Record<string, string | undefined>>,
): DbSettings | null {
  const url = env.TEST_DATABASE_URL;
  if (!url) return null;
  const real = env.DATABASE_URL;
  if (real && databaseKey(url) === databaseKey(real)) {
    throw new TestDatabaseConfigError(
      "TEST_DATABASE_URL points at the same database as DATABASE_URL. Integration " +
        "tests truncate and drop tables; use a separate, disposable database.",
    );
  }
  try {
    return loadDbSettings({ DATABASE_URL: url });
  } catch (error) {
    throw new TestDatabaseConfigError(`TEST_DATABASE_URL is invalid: ${(error as Error).message}`);
  }
}

export const testDbSettings = resolveTestDbSettings(process.env);
export const hasTestDatabase = testDbSettings !== null;

function requireTestDb(): DbSettings {
  if (!testDbSettings) throw new Error("integration tests are skipped without TEST_DATABASE_URL");
  return testDbSettings;
}

export async function migrateTestDb(): Promise<void> {
  await migrate(requireTestDb(), "up");
}

/** Settings for the real app, pointed at the test database. */
export function integrationSettings(env: Record<string, string> = {}): Settings {
  return makeSettings({ DATABASE_URL: requireTestDb().databaseUrl.reveal(), ...env });
}

/** The real app: real repository, real database, no fakes. Call `close()` when done. */
export function realApp(settings: Settings = integrationSettings()) {
  const { logger } = captureLogger();
  const database = Database.fromSettings(settings, logger);
  const repository = new SqlLinkRepository(database.db);
  return {
    app: createApp({ settings, database, repository, logger, webDir: null }),
    database,
    repository,
    close: () => database.close(),
  };
}

export async function truncateLinks(database: Database): Promise<void> {
  await sql`TRUNCATE links RESTART IDENTITY`.execute(database.db);
}
