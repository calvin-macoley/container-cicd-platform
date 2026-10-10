/**
 * Database pool and readiness probe.
 *
 * Creating the pool does not connect; connections are opened on first use,
 * so the app starts (and /healthz answers) even when the database is down.
 */

import { Kysely, PostgresDialect, type ColumnType, type Generated } from "kysely";
import pg from "pg";

import type { DbSettings } from "./config.js";
import type { Logger } from "./logging.js";

/** Row shape of the `links` table (see migrations/0001_create_links.ts). */
export interface LinksTable {
  id: Generated<number>;
  code: string;
  target_url: string;
  created_at: ColumnType<Date, never, never>;
  expires_at: Date | null;
  click_count: ColumnType<number, never, number>;
  last_clicked_at: ColumnType<Date | null, never, Date | null>;
}

export interface Schema {
  links: LinksTable;
}

const INT8_OID = 20;

// BIGINT columns (id, click_count) arrive as strings by default. Counts stay far
// below 2^53, so plain numbers are safe and keep the API's JSON numeric.
const types = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    oid === INT8_OID
      ? (value: string) => Number(value)
      : pg.types.getTypeParser(oid, format ?? "text")) as typeof pg.types.getTypeParser,
};

export function buildPool(settings: DbSettings): pg.Pool {
  return new pg.Pool({
    connectionString: settings.connectionString.reveal(),
    max: settings.dbPoolMax,
    types,
  });
}

/** Readiness probe: is the database reachable and answering? */
export interface DatabaseProbe {
  ping(withinSeconds: number): Promise<boolean>;
  close(): Promise<void>;
}

export class Database implements DatabaseProbe {
  readonly db: Kysely<Schema>;

  constructor(
    readonly pool: pg.Pool,
    private readonly connectionString: string,
    private readonly logger?: Logger,
  ) {
    this.db = new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
  }

  static fromSettings(settings: DbSettings, logger?: Logger): Database {
    return new Database(buildPool(settings), settings.connectionString.reveal(), logger);
  }

  /**
   * True if a trivial query succeeds within `withinSeconds`.
   *
   * Uses a fresh connection outside the pool: if probes borrowed from the
   * request pool, a replica whose pool is merely busy would report not-ready
   * and be pulled from load balancing, shifting its traffic onto the others.
   */
  async ping(withinSeconds: number): Promise<boolean> {
    const client = new pg.Client({ connectionString: this.connectionString });
    // Swallow late connection errors after a timeout; the result is already decided.
    client.on("error", () => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), withinSeconds * 1000);
    });
    try {
      await Promise.race([
        (async () => {
          await client.connect();
          await client.query("SELECT 1");
        })(),
        timeout,
      ]);
      return true;
    } catch (error) {
      const { name, code } = error as { name?: string; code?: string };
      this.logger?.warn({ error: code ?? name }, "database ping failed");
      return false;
    } finally {
      clearTimeout(timer);
      void client.end().catch(() => undefined);
    }
  }

  /** Closes the pool (Kysely's destroy ends the pg pool it wraps). */
  async close(): Promise<void> {
    await this.db.destroy();
  }
}
