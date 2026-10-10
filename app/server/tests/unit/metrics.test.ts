import request from "supertest";
import { describe, expect, it } from "vitest";

import { Metrics, methodLabel, UNMATCHED_ROUTE } from "../../src/metrics.js";
import { FakeLinkRepository } from "../fakes.js";
import { makeSettings, makeTestApp } from "../helpers.js";

const count = (m: Metrics, method: string, route: string, status: string) =>
  m.sample("http_requests_total", { method, route, status });

describe("GET /metrics", () => {
  it("exposes Prometheus text", async () => {
    const { app } = makeTestApp();
    await request(app).get("/healthz");

    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.text).toContain("http_requests_total");
    expect(res.text).toContain("http_request_duration_seconds_bucket");
    expect(res.text).toContain(
      'app_build_info{version="1.2.3",git_sha="abc1234",environment="test"} 1',
    );
    expect(res.text).toMatch(/^app_chaos_error_rate 0$/m);
    expect(res.text).toContain("process_cpu_seconds_total");
  });
});

describe("request metrics", () => {
  it("label link routes by template, never the raw path", async () => {
    const { app, metrics } = makeTestApp();
    await request(app).post("/api/links").send({ url: "https://example.com", alias: "m01" });
    await request(app).get("/api/links/m01");
    await request(app).get("/m01");
    await request(app).head("/m01");
    await request(app).delete("/api/links/m01");

    for (const [method, route, status] of [
      ["POST", "/api/links", "201"],
      ["GET", "/api/links/{code}", "200"],
      ["GET", "/{code}", "307"],
      ["HEAD", "/{code}", "307"],
      ["DELETE", "/api/links/{code}", "204"],
    ] as const) {
      expect(await count(metrics, method, route, status), `${method} ${route}`).toBe(1);
    }
    const body = (await request(app).get("/metrics")).text;
    expect(body).not.toContain('route="/api/links/m01"');
    expect(body).not.toContain('route="/m01"');
  });

  it("count each request in the latency histogram too", async () => {
    const { app, metrics } = makeTestApp();
    await request(app).get("/version");
    await request(app).get("/version");
    const labels = { method: "GET", route: "/version", status: "200" };
    expect(await metrics.sample("http_request_duration_seconds_count", labels)).toBe(2);
  });

  it("share one label for unmatched paths", async () => {
    const { app, metrics } = makeTestApp();
    await request(app).get("/random/a");
    await request(app).get("/random/b");
    expect(await count(metrics, "GET", UNMATCHED_ROUTE, "404")).toBe(2);
  });

  it("keep the template on 405", async () => {
    const { app, metrics } = makeTestApp();
    await request(app).post("/version");
    expect(await count(metrics, "POST", "/version", "405")).toBe(1);
  });

  it("record unhandled errors as 500 under the route template", async () => {
    class BrokenRepository extends FakeLinkRepository {
      override async get(): Promise<never> {
        throw new Error("boom");
      }
    }
    const { app, metrics } = makeTestApp({ repo: new BrokenRepository() });
    await request(app).get("/api/links/abc");
    expect(await count(metrics, "GET", "/api/links/{code}", "500")).toBe(1);
  });

  it("share one label for unknown methods", async () => {
    const { app, metrics } = makeTestApp();
    // Node's HTTP parser accepts only registered methods; PROPFIND and MKCOL are among them.
    await request(app).propfind("/healthz");
    await request(app).mkcol("/healthz");
    expect(await count(metrics, "OTHER", "/healthz", "405")).toBe(2);
  });
});

describe("access log", () => {
  it("writes one line per request, probes at DEBUG", async () => {
    const { app, logs } = makeTestApp();
    const res = await request(app).get("/version");
    await request(app).get("/healthz");

    const access = logs.filter((line) => line.logger === "shortener.access");
    const byRoute = Object.fromEntries(access.map((line) => [line.route, line]));
    expect(byRoute["/version"]).toMatchObject({
      level: "INFO",
      message: "request",
      method: "GET",
      path: "/version",
      status: 200,
      request_id: res.headers["x-request-id"],
    });
    expect(byRoute["/version"]?.duration_ms).toEqual(expect.any(Number));
    expect(byRoute["/healthz"]?.level).toBe("DEBUG");
  });
});

describe("helpers", () => {
  it("methodLabel buckets unknown methods", () => {
    expect(methodLabel("GET")).toBe("GET");
    expect(methodLabel("PROPFIND")).toBe("OTHER");
  });

  it("separate apps have separate registries", () => {
    const settings = makeSettings();
    expect(new Metrics(settings).registry).not.toBe(new Metrics(settings).registry);
  });
});
