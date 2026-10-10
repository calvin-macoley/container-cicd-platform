import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { RESERVED_CODES } from "../../src/services/links.js";
import { makeTestApp } from "../helpers.js";

async function createAlias(app: Express, alias: string, url = "https://example.com/dest") {
  const res = await request(app).post("/api/links").send({ url, alias });
  expect(res.status).toBe(201);
}

describe("GET /:code", () => {
  it("redirects and counts the click", async () => {
    const { app, repo } = makeTestApp();
    await createAlias(app, "goto");

    const res = await request(app).get("/goto");

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe("https://example.com/dest");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(repo.links.get("goto")?.clickCount).toBe(1);
  });

  it.each(["/favicon.ico", "/ab", "/" + "a".repeat(33), "/api", "/assets", "/docs-x.y"])(
    "answers 404 for %s without a lookup",
    async (path) => {
      const { app, repo } = makeTestApp();
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(repo.resolveCalls).toEqual([]);
    },
  );

  it("answers 404 for a missing link", async () => {
    const res = await request(makeTestApp().app).get("/missing1");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Link not found" });
  });

  it("answers 404 for an expired link without counting", async () => {
    const { app, repo } = makeTestApp();
    await createAlias(app, "stale");
    repo.patch("stale", { expiresAt: new Date(Date.now() - 1000) });

    expect((await request(app).get("/stale")).status).toBe(404);
    expect(repo.links.get("stale")?.clickCount).toBe(0);
  });

  it("answers 404 for nested unknown paths", async () => {
    const res = await request(makeTestApp().app).get("/a/b/c");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Not Found" });
  });

  it("answers 405 for other methods", async () => {
    const res = await request(makeTestApp().app).post("/somecode");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
  });

  it("does not shadow reserved paths", async () => {
    const { app } = makeTestApp();
    for (const path of ["/healthz", "/readyz", "/version"]) {
      expect((await request(app).get(path)).status, path).toBe(200);
    }
  });
});

describe("reserved codes", () => {
  it("cover every top-level route", () => {
    // A new top-level route must be added to RESERVED_CODES, or a link could shadow it.
    type Layer = { route?: { path: string }; handle?: { stack?: Layer[] } };
    const paths = (stack: Layer[]): string[] =>
      stack.flatMap((layer) =>
        layer.route ? [layer.route.path] : layer.handle?.stack ? paths(layer.handle.stack) : [],
      );
    const { app } = makeTestApp();
    const firstSegments = new Set(
      paths((app.router as unknown as { stack: Layer[] }).stack)
        .map((path) => path.split("/")[1] ?? "")
        .filter((segment) => segment && !segment.startsWith(":")),
    );

    expect([...firstSegments].sort()).toEqual(["api", "healthz", "metrics", "readyz", "version"]);
    for (const segment of firstSegments) expect(RESERVED_CODES).toContain(segment);
  });
});

describe("HEAD /:code", () => {
  it("returns the same redirect as GET without counting", async () => {
    const { app, repo } = makeTestApp();
    await createAlias(app, "peek");
    const getRes = await request(app).get("/peek");
    const afterGet = repo.links.get("peek");
    expect(afterGet?.clickCount).toBe(1);

    const headRes = await request(app).head("/peek");

    expect(headRes.status).toBe(307);
    expect(headRes.headers.location).toBe(getRes.headers.location);
    expect(headRes.headers["cache-control"]).toBe("no-store");
    expect(headRes.text ?? "").toBe("");
    // HEAD changed nothing: same count, same last-click time.
    expect(repo.links.get("peek")).toEqual(afterGet);
  });

  it("answers 404 for a missing link", async () => {
    expect((await request(makeTestApp().app).head("/missing1")).status).toBe(404);
  });

  it("skips the lookup for invalid codes", async () => {
    const { app, repo } = makeTestApp();
    expect((await request(app).head("/favicon.ico")).status).toBe(404);
    expect(repo.resolveCalls).toEqual([]);
  });

  it("answers 404 for an expired link", async () => {
    const { app, repo } = makeTestApp();
    await createAlias(app, "gone1");
    repo.patch("gone1", { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).head("/gone1")).status).toBe(404);
  });
});
