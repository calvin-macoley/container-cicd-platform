import request from "supertest";
import { describe, expect, it } from "vitest";

import { CodeConflictError } from "../../src/repository.js";
import { FakeLinkRepository } from "../fakes.js";
import { fromNow, makeTestApp } from "../helpers.js";

describe("POST /api/links", () => {
  it("creates a link", async () => {
    const { app } = makeTestApp();

    const res = await request(app).post("/api/links").send({ url: "https://example.com/a?b=c" });

    expect(res.status).toBe(201);
    expect(res.body.target_url).toBe("https://example.com/a?b=c");
    expect(res.body.short_url).toBe(`https://sho.rt/${res.body.code}`);
    expect(res.body.click_count).toBe(0);
    expect(res.body.is_expired).toBe(false);
    expect(res.body.expires_at).toBeNull();
    expect(res.body.last_clicked_at).toBeNull();
    expect(res.headers.location).toBe(`/api/links/${res.body.code}`);
  });

  it("normalises the URL like the Python service", async () => {
    const res = await request(makeTestApp().app)
      .post("/api/links")
      .send({ url: "https://Example.com" });
    expect(res.body.target_url).toBe("https://example.com/");
  });

  it("creates a link with alias and expiry", async () => {
    const expires = fromNow(3_600_000);

    const res = await request(makeTestApp().app)
      .post("/api/links")
      .send({ url: "https://example.com", alias: "promo_2026", expires_at: expires });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("promo_2026");
    expect(res.body.expires_at).toBe(expires);
  });

  it("accepts an explicit offset and null optionals", async () => {
    const res = await request(makeTestApp().app)
      .post("/api/links")
      .send({ url: "https://example.com", alias: null, expires_at: "2999-01-01T02:00:00+02:00" });
    expect(res.status).toBe(201);
    expect(res.body.expires_at).toBe("2999-01-01T00:00:00.000Z");
  });

  it.each([
    {},
    { url: "not a url" },
    { url: "ftp://example.com/file" },
    { url: "javascript:alert(1)" },
    { url: "https://example.com/" + "a".repeat(2048) },
    { url: "https://example.com", alias: "ab" },
    { url: "https://example.com", alias: "a".repeat(33) },
    { url: "https://example.com", alias: "has space" },
    { url: "https://example.com", alias: "slash/no" },
    { url: "https://example.com", expires_at: "2030-01-01T00:00:00" }, // naive
    { url: "https://example.com", unexpected: 1 },
    { url: 42 },
  ])("rejects %j with 422", async (payload) => {
    const res = await request(makeTestApp().app).post("/api/links").send(payload);
    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.detail)).toBe(true);
    expect(res.body.detail[0]).toMatchObject({ loc: expect.arrayContaining(["body"]) });
  });

  it("names the failing field in validation errors", async () => {
    const res = await request(makeTestApp().app)
      .post("/api/links")
      .send({ url: "https://example.com", alias: "ab" });
    expect(res.body.detail).toEqual([
      expect.objectContaining({ loc: ["body", "alias"], msg: expect.any(String) }),
    ]);
  });

  it("rejects malformed JSON with 422", async () => {
    const res = await request(makeTestApp().app)
      .post("/api/links")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(422);
    expect(res.body.detail[0].type).toBe("json_invalid");
  });

  it.each([
    [{ url: "https://example.com", alias: "healthz" }, "reserved"],
    [{ url: "https://sho.rt/loop" }, "must not point at this shortener"],
    [{ url: "https://example.com", expires_at: "2000-01-01T00:00:00Z" }, "future"],
  ])("rejects business rule violation %j", async (payload, detail) => {
    const res = await request(makeTestApp().app).post("/api/links").send(payload);
    expect(res.status).toBe(422);
    expect(res.body.detail).toContain(detail);
  });

  it("returns 409 for a taken alias", async () => {
    const { app } = makeTestApp();
    const payload = { url: "https://example.com", alias: "dup" };
    expect((await request(app).post("/api/links").send(payload)).status).toBe(201);

    const res = await request(app).post("/api/links").send(payload);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ detail: "Alias already in use" });
  });

  it("returns 503 when no free code can be found", async () => {
    class FullRepository extends FakeLinkRepository {
      override async create(code: string): Promise<never> {
        this.createCalls.push(code);
        throw new CodeConflictError(code);
      }
    }
    const res = await request(makeTestApp({ repo: new FullRepository() }).app)
      .post("/api/links")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ detail: "Could not allocate a short code; retry" });
  });

  it("returns a JSON 500 on unexpected errors", async () => {
    class BrokenRepository extends FakeLinkRepository {
      override async create(): Promise<never> {
        throw new Error("boom");
      }
    }
    const res = await request(makeTestApp({ repo: new BrokenRepository() }).app)
      .post("/api/links")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: "Internal Server Error" });
  });
});

describe("GET /api/links/:code", () => {
  it("returns details including clicks", async () => {
    const { app } = makeTestApp();
    await request(app).post("/api/links").send({ url: "https://example.com", alias: "info" });
    await request(app).get("/info");

    const res = await request(app).get("/api/links/info");

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("info");
    expect(res.body.click_count).toBe(1);
    expect(res.body.last_clicked_at).not.toBeNull();
  });

  it("still shows expired links", async () => {
    const { app, repo } = makeTestApp();
    await request(app).post("/api/links").send({ url: "https://example.com", alias: "old" });
    repo.patch("old", { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).get("/api/links/old");

    expect(res.status).toBe(200);
    expect(res.body.is_expired).toBe(true);
    expect((await request(app).get("/old")).status).toBe(404);
  });

  it("returns 404 for a missing link", async () => {
    const res = await request(makeTestApp().app).get("/api/links/missing");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Link not found" });
  });

  it("returns 405 for other methods", async () => {
    const res = await request(makeTestApp().app).put("/api/links/x").send({});
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, DELETE");
  });
});

describe("DELETE /api/links/:code", () => {
  it("deletes the link", async () => {
    const { app } = makeTestApp();
    await request(app).post("/api/links").send({ url: "https://example.com", alias: "gone" });

    const res = await request(app).delete("/api/links/gone");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect((await request(app).get("/api/links/gone")).status).toBe(404);
    expect((await request(app).get("/gone")).status).toBe(404);
  });

  it("returns 404 for a missing link", async () => {
    expect((await request(makeTestApp().app).delete("/api/links/missing")).status).toBe(404);
  });

  it("refuses to delete the collection", async () => {
    expect((await request(makeTestApp().app).delete("/api/links")).status).toBe(405);
  });
});
