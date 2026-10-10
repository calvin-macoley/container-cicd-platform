import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hasTestDatabase, migrateTestDb, realApp, truncateLinks } from "./db.js";

describe.skipIf(!hasTestDatabase)("redirects against PostgreSQL", () => {
  let ctx: ReturnType<typeof realApp>;

  beforeAll(async () => {
    await migrateTestDb();
    ctx = realApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => truncateLinks(ctx.database));

  const create = (alias: string, url = "https://example.com/dest") =>
    request(ctx.app).post("/api/links").send({ url, alias });
  const clicks = async (code: string) =>
    (await request(ctx.app).get(`/api/links/${code}`)).body.click_count;

  it("redirects and counts the click", async () => {
    await create("hop");

    const res = await request(ctx.app).get("/hop");

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe("https://example.com/dest");
    const details = (await request(ctx.app).get("/api/links/hop")).body;
    expect(details.click_count).toBe(1);
    expect(details.last_clicked_at).not.toBeNull();
  });

  it("counts every one of many concurrent clicks", async () => {
    await create("busy");

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => request(ctx.app).get("/busy")),
    );

    expect(responses.every((r) => r.status === 307)).toBe(true);
    expect(await clicks("busy")).toBe(25);
  });

  it("answers 404 for a missing link", async () => {
    expect((await request(ctx.app).get("/absent")).status).toBe(404);
  });

  it("answers 404 for an expired link and does not count it", async () => {
    await create("old1");
    await sql`UPDATE links SET expires_at = now() - interval '1 second' WHERE code = 'old1'`.execute(
      ctx.database.db,
    );

    expect((await request(ctx.app).get("/old1")).status).toBe(404);
    expect(await clicks("old1")).toBe(0);
  });

  it("answers HEAD with the redirect without counting", async () => {
    await create("peek");

    const res = await request(ctx.app).head("/peek");

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe("https://example.com/dest");
    expect(await clicks("peek")).toBe(0);
  });
});
