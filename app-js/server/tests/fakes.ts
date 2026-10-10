/** In-memory stand-ins for the database layer (unit tests only). */

import type { DatabaseProbe } from "../src/db.js";
import { CodeConflictError, type LinkRecord, type LinkRepository } from "../src/repository.js";

type Clock = () => Date;

const isExpired = (record: LinkRecord, now: Date): boolean =>
  record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime();

export class FakeLinkRepository implements LinkRepository {
  readonly links = new Map<string, LinkRecord>();
  readonly createCalls: string[] = [];
  readonly resolveCalls: string[] = [];

  constructor(public clock: Clock = () => new Date()) {}

  /** Replace fields of a stored link (e.g. to expire it). */
  patch(code: string, changes: Partial<LinkRecord>): void {
    const record = this.links.get(code);
    if (!record) throw new Error(`no link ${code}`);
    this.links.set(code, { ...record, ...changes });
  }

  async create(code: string, targetUrl: string, expiresAt: Date | null): Promise<LinkRecord> {
    this.createCalls.push(code);
    if (this.links.has(code)) throw new CodeConflictError(code);
    const record: LinkRecord = {
      code,
      targetUrl,
      createdAt: this.clock(),
      expiresAt,
      clickCount: 0,
      lastClickedAt: null,
    };
    this.links.set(code, record);
    return record;
  }

  async get(code: string): Promise<LinkRecord | null> {
    return this.links.get(code) ?? null;
  }

  async resolveAndCount(code: string): Promise<string | null> {
    this.resolveCalls.push(code);
    const record = this.links.get(code);
    const now = this.clock();
    if (!record || isExpired(record, now)) return null;
    this.links.set(code, { ...record, clickCount: record.clickCount + 1, lastClickedAt: now });
    return record.targetUrl;
  }

  async getActiveTarget(code: string): Promise<string | null> {
    const record = this.links.get(code);
    if (!record || isExpired(record, this.clock())) return null;
    return record.targetUrl;
  }

  async delete(code: string): Promise<boolean> {
    return this.links.delete(code);
  }
}

export class FakeDatabase implements DatabaseProbe {
  pings = 0;

  constructor(public healthy = true) {}

  async ping(): Promise<boolean> {
    this.pings++;
    return this.healthy;
  }

  async close(): Promise<void> {}
}
