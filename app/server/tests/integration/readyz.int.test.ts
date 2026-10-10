import request from "supertest";
import { describe, expect, it } from "vitest";

import { Database } from "../../src/db.js";
import { makeSettings } from "../helpers.js";
import { hasTestDatabase, integrationSettings, realApp } from "./db.js";

describe.skipIf(!hasTestDatabase)("readiness against PostgreSQL", () => {
  it("is ready with a real database", async () => {
    const ctx = realApp();
    try {
      const res = await request(ctx.app).get("/readyz");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ready" });
    } finally {
      await ctx.close();
    }
  });

  it("is unavailable when the database is unreachable, while staying live", async () => {
    // Port 1 on localhost: connection refused immediately.
    const ctx = realApp(
      makeSettings({
        DATABASE_URL: "postgresql://u:p@127.0.0.1:1/none",
        READINESS_TIMEOUT_SECONDS: "1",
      }),
    );
    try {
      const res = await request(ctx.app).get("/readyz");
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: "unavailable" });
      expect((await request(ctx.app).get("/healthz")).status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  it("pings successfully", async () => {
    const database = Database.fromSettings(integrationSettings());
    try {
      expect(await database.ping(2)).toBe(true);
    } finally {
      await database.close();
    }
  });

  it("stays ready while the request pool is exhausted", async () => {
    const ctx = realApp(integrationSettings({ DB_POOL_SIZE: "1", DB_MAX_OVERFLOW: "0" }));
    // Hold the only pooled connection, as a busy replica would.
    const held = await ctx.database.pool.connect();
    try {
      expect((await request(ctx.app).get("/readyz")).status).toBe(200);
    } finally {
      held.release();
      await ctx.close();
    }
  });
});
