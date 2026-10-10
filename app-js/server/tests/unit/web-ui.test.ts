import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestApp } from "../helpers.js";

describe("web UI", () => {
  let webDir: string;

  beforeAll(() => {
    webDir = mkdtempSync(join(tmpdir(), "shortener-web-"));
    mkdirSync(join(webDir, "assets"));
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Shortener</title>");
    writeFileSync(join(webDir, "assets", "index-abc123.js"), "console.log(1)");
  });
  afterAll(() => rmSync(webDir, { recursive: true, force: true }));

  it("serves index.html at / and always revalidates it", async () => {
    const res = await request(makeTestApp({ webDir }).app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).toContain("<title>Shortener</title>");
  });

  it("serves hashed assets with a long immutable cache", async () => {
    const res = await request(makeTestApp({ webDir }).app).get("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers 404 for a missing asset without a link lookup", async () => {
    const { app, repo } = makeTestApp({ webDir });
    expect((await request(app).get("/assets/missing.js")).status).toBe(404);
    expect(repo.resolveCalls).toEqual([]);
  });

  it("labels asset requests with one route template and logs the full path", async () => {
    const { app, metrics, logs } = makeTestApp({ webDir });
    await request(app).get("/assets/index-abc123.js");
    await request(app).get("/assets/missing.js");
    const sample = (status: string) =>
      metrics.sample("http_requests_total", { method: "GET", route: "/assets/*", status });
    expect(await sample("200")).toBe(1);
    expect(await sample("404")).toBe(1);
    const access = logs.filter((line) => line.logger === "shortener.access");
    expect(access.map((line) => line.path)).toEqual([
      "/assets/index-abc123.js",
      "/assets/missing.js",
    ]);
  });

  it("keeps redirects working beside the UI", async () => {
    const { app } = makeTestApp({ webDir });
    await request(app).post("/api/links").send({ url: "https://example.com", alias: "ui-ok" });
    expect((await request(app).get("/ui-ok")).status).toBe(307);
  });

  it("answers 404 at / when no UI is built", async () => {
    expect((await request(makeTestApp({ webDir: null }).app).get("/")).status).toBe(404);
  });
});
