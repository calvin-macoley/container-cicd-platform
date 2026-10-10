import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CodeConflictError } from "../../src/repository.js";
import { hasTestDatabase, migrateTestDb, realApp, truncateLinks } from "./db.js";

describe.skipIf(!hasTestDatabase)("links API against PostgreSQL", () => {
  let ctx: ReturnType<typeof realApp>;

  beforeAll(async () => {
    await migrateTestDb();
    ctx = realApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => truncateLinks(ctx.database));

  const count = async () =>
    (await sql<{ n: number }>`SELECT count(*)::int AS n FROM links`.execute(ctx.database.db))
      .rows[0]?.n;

  it("creates and reads back a link", async () => {
    const created = await request(ctx.app)
      .post("/api/links")
      .send({ url: "https://example.com/x" });
    expect(created.status).toBe(201);

    const res = await request(ctx.app).get(`/api/links/${created.body.code}`);

    expect(res.status).toBe(200);
    expect(res.body.target_url).toBe("https://example.com/x");
    expect(res.body.click_count).toBe(0);
    expect(res.body.last_clicked_at).toBeNull();
    const createdAt = new Date(res.body.created_at);
    expect(Math.abs(Date.now() - createdAt.getTime())).toBeLessThan(60_000);
  });

  it("persists alias and expiry", async () => {
    const expires = new Date(Date.now() + 86_400_000);
    const res = await request(ctx.app)
      .post("/api/links")
      .send({ url: "https://example.com", alias: "persist", expires_at: expires.toISOString() });
    expect(res.status).toBe(201);

    const row = await ctx.database.db
      .selectFrom("links")
      .select("expires_at")
      .where("code", "=", "persist")
      .executeTakeFirstOrThrow();
    expect(row.expires_at).toEqual(expires);
  });

  it("returns 409 for a taken alias", async () => {
    const payload = { url: "https://example.com", alias: "taken" };
    expect((await request(ctx.app).post("/api/links").send(payload)).status).toBe(201);
    expect((await request(ctx.app).post("/api/links").send(payload)).status).toBe(409);
  });

  it("lets exactly one of several concurrent creates of the same alias win", async () => {
    const payload = { url: "https://example.com", alias: "race" };

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(ctx.app).post("/api/links").send(payload)),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, ...Array(7).fill(409)]);
  });

  it("does not touch the database on validation errors", async () => {
    expect((await request(ctx.app).post("/api/links").send({ url: "nope" })).status).toBe(422);
    expect(await count()).toBe(0);
  });

  it("still shows expired links", async () => {
    await request(ctx.app)
      .post("/api/links")
      .send({ url: "https://example.com", alias: "expired" });
    await sql`UPDATE links SET expires_at = now() - interval '1 second' WHERE code = 'expired'`.execute(
      ctx.database.db,
    );

    const res = await request(ctx.app).get("/api/links/expired");

    expect(res.status).toBe(200);
    expect(res.body.is_expired).toBe(true);
  });

  it("deletes a link", async () => {
    await request(ctx.app).post("/api/links").send({ url: "https://example.com", alias: "bye" });

    expect((await request(ctx.app).delete("/api/links/bye")).status).toBe(204);
    expect((await request(ctx.app).delete("/api/links/bye")).status).toBe(404);
    expect((await request(ctx.app).get("/api/links/bye")).status).toBe(404);
    expect(await count()).toBe(0);
  });

  it("returns 404 for a missing link", async () => {
    expect((await request(ctx.app).get("/api/links/nothere")).status).toBe(404);
  });

  it("raises CodeConflictError from the repository and keeps working", async () => {
    await ctx.repository.create("dupe1", "https://example.com", null);
    await expect(
      ctx.repository.create("dupe1", "https://example.org", null),
    ).rejects.toBeInstanceOf(CodeConflictError);
    expect((await ctx.repository.get("dupe1"))?.targetUrl).toBe("https://example.com");
  });
});
