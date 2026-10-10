import request from "supertest";
import { describe, expect, it } from "vitest";

import { logStartup } from "../../src/app.js";
import { CHAOS_DETAIL, ChaosInjector } from "../../src/chaos.js";
import { captureLogger, makeSettings, makeTestApp } from "../helpers.js";

describe("chaos", () => {
  it("fails /api requests below the rate, logged and counted under the template", async () => {
    const { app, metrics, logs } = makeTestApp({
      env: { CHAOS_ERROR_RATE: "0.5" },
      rng: () => 0.49,
    });

    const res = await request(app).post("/api/links").send({ url: "https://example.com" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: CHAOS_DETAIL });
    expect(logs.some((line) => line.chaos === true && line.level === "WARNING")).toBe(true);
    const labels = { method: "POST", route: "/api/links", status: "500" };
    expect(await metrics.sample("http_requests_total", labels)).toBe(1);
  });

  it("covers every /api/links method", async () => {
    const { app } = makeTestApp({ env: { CHAOS_ERROR_RATE: "1" }, rng: () => 0 });
    expect((await request(app).get("/api/links/abc")).status).toBe(500);
    expect((await request(app).delete("/api/links/abc")).status).toBe(500);
  });

  it("does not fail at or above the rate", async () => {
    const { app } = makeTestApp({ env: { CHAOS_ERROR_RATE: "0.5" }, rng: () => 0.5 });
    const res = await request(app).post("/api/links").send({ url: "https://example.com" });
    expect(res.status).toBe(201);
  });

  it("never fails at rate zero", async () => {
    const { app } = makeTestApp({ rng: () => 0 });
    const res = await request(app).post("/api/links").send({ url: "https://example.com" });
    expect(res.status).toBe(201);
  });

  it("leaves non-API routes alone", async () => {
    const { app } = makeTestApp({ env: { CHAOS_ERROR_RATE: "1" }, rng: () => 0 });
    for (const path of ["/healthz", "/readyz", "/version", "/metrics"]) {
      expect((await request(app).get(path)).status, path).toBe(200);
    }
    expect((await request(app).get("/whatever")).status).toBe(404); // reached the handler
  });

  it("is reported as a gauge", async () => {
    const { app } = makeTestApp({ env: { CHAOS_ERROR_RATE: "0.25" } });
    expect((await request(app).get("/metrics")).text).toMatch(/^app_chaos_error_rate 0\.25$/m);
  });

  it("warns at startup when enabled", () => {
    const { logger, lines } = captureLogger();
    logStartup(logger, makeSettings({ CHAOS_ERROR_RATE: "0.25" }));
    expect(lines.map((line) => line.message)).toEqual([
      "starting",
      "chaos enabled: a fraction of /api/* requests will fail on purpose",
    ]);
    expect(lines[1]).toMatchObject({ level: "WARNING", chaos_error_rate: 0.25 });
  });

  it("does not warn at startup when disabled", () => {
    const { logger, lines } = captureLogger();
    logStartup(logger, makeSettings());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ message: "starting", version: "1.2.3", environment: "test" });
  });

  it("injector at rate one always fails, at zero never", () => {
    expect(new ChaosInjector(1).shouldFail()).toBe(true);
    expect(new ChaosInjector(0).shouldFail()).toBe(false);
  });
});
