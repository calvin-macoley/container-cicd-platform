/**
 * Persistence for links.
 *
 * Services depend on the `LinkRepository` interface; `SqlLinkRepository` is
 * the PostgreSQL implementation. Unit tests use an in-memory fake.
 */

import { sql, type Kysely, type Selectable } from "kysely";

import type { LinksTable, Schema } from "./db.js";

const CODE_UNIQUE_CONSTRAINT = "uq_links_code";
const UNIQUE_VIOLATION = "23505";

export interface LinkRecord {
  readonly code: string;
  readonly targetUrl: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly clickCount: number;
  readonly lastClickedAt: Date | null;
}

/** The code is already taken. */
export class CodeConflictError extends Error {
  override name = "CodeConflictError";
}

export interface LinkRepository {
  /** Insert a link. Throws CodeConflictError if `code` exists. */
  create(code: string, targetUrl: string, expiresAt: Date | null): Promise<LinkRecord>;
  /** Return the link (expired or not), or null. */
  get(code: string): Promise<LinkRecord | null>;
  /** Atomically count a click on an unexpired link and return its target, else null. */
  resolveAndCount(code: string): Promise<string | null>;
  /** Target of an unexpired link without counting a click, else null. */
  getActiveTarget(code: string): Promise<string | null>;
  /** Delete the link; false if it did not exist. */
  delete(code: string): Promise<boolean>;
}

function toRecord(row: Selectable<LinksTable>): LinkRecord {
  return {
    code: row.code,
    targetUrl: row.target_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    clickCount: row.click_count,
    lastClickedAt: row.last_clicked_at,
  };
}

function isCodeConflict(error: unknown): boolean {
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && constraint === CODE_UNIQUE_CONSTRAINT;
}

// Expiry is checked against the database clock so every replica agrees.
const isActive = sql<boolean>`(expires_at IS NULL OR expires_at > now())`;

export class SqlLinkRepository implements LinkRepository {
  constructor(private readonly db: Kysely<Schema>) {}

  async create(code: string, targetUrl: string, expiresAt: Date | null): Promise<LinkRecord> {
    try {
      const row = await this.db
        .insertInto("links")
        .values({ code, target_url: targetUrl, expires_at: expiresAt })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      // Rely on the unique constraint, not a read-before-insert, so
      // concurrent creates of the same alias cannot both succeed.
      if (isCodeConflict(error)) throw new CodeConflictError(code, { cause: error });
      throw error;
    }
  }

  async get(code: string): Promise<LinkRecord | null> {
    const row = await this.db
      .selectFrom("links")
      .selectAll()
      .where("code", "=", code)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async resolveAndCount(code: string): Promise<string | null> {
    // One statement: no read-then-write race between concurrent clicks.
    const row = await this.db
      .updateTable("links")
      .set({ click_count: sql`click_count + 1`, last_clicked_at: sql`now()` })
      .where("code", "=", code)
      .where(isActive)
      .returning("target_url")
      .executeTakeFirst();
    return row?.target_url ?? null;
  }

  async getActiveTarget(code: string): Promise<string | null> {
    // Same expiry rule as resolveAndCount (database clock), but read-only.
    const row = await this.db
      .selectFrom("links")
      .select("target_url")
      .where("code", "=", code)
      .where(isActive)
      .executeTakeFirst();
    return row?.target_url ?? null;
  }

  async delete(code: string): Promise<boolean> {
    const row = await this.db
      .deleteFrom("links")
      .where("code", "=", code)
      .returning("id")
      .executeTakeFirst();
    return row !== undefined;
  }
}
