import request from "supertest";
import { describe, expect, it } from "vitest";

import { resolveRequestId } from "../../src/middleware/request-id.js";
import { FakeLinkRepository } from "../fakes.js";
import { makeTestApp } from "../helpers.js";

describe("request ID", () => {
  it("is generated when missing", async () => {
    const res = await request(makeTestApp().app).get("/healthz");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("propagates a valid incoming ID", async () => {
    const res = await request(makeTestApp().app)
      .get("/healthz")
      .set("X-Request-ID", "abc-123.def_4");
    expect(res.headers["x-request-id"]).toBe("abc-123.def_4");
  });

  it("replaces an unsafe incoming ID", async () => {
    const res = await request(makeTestApp().app).get("/healthz").set("X-Request-ID", 'bad"id {}');
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is on error responses too", async () => {
    const res = await request(makeTestApp().app).get("/nope/nope");
    expect(res.status).toBe(404);
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("appears on log lines written while handling the request", async () => {
    class BrokenRepository extends FakeLinkRepository {
      override async get(): Promise<never> {
        await Promise.resolve();
        throw new Error("boom");
      }
    }
    const { app, logs } = makeTestApp({ repo: new BrokenRepository() });

    const res = await request(app).get("/api/links/abc").set("X-Request-ID", "trace-me");

    const error = logs.find((line) => line.message === "unhandled error");
    expect(res.status).toBe(500);
    expect(error).toMatchObject({ level: "ERROR", request_id: "trace-me" });
    expect(JSON.stringify(error?.exc_info)).toContain("boom");
  });

  it("rejects overlong and empty IDs", () => {
    expect(resolveRequestId("a".repeat(129))).not.toBe("a".repeat(129));
    expect(resolveRequestId("a".repeat(128))).toBe("a".repeat(128));
    expect(resolveRequestId("")).not.toBe("");
  });
});
