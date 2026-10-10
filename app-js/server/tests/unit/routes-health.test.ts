import request from "supertest";
import { describe, expect, it } from "vitest";

import { FakeDatabase } from "../fakes.js";
import { makeTestApp } from "../helpers.js";

describe("GET /healthz", () => {
  it("answers ok", async () => {
    const res = await request(makeTestApp().app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("does not advertise Express", async () => {
    const res = await request(makeTestApp().app).get("/healthz");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects other methods", async () => {
    expect((await request(makeTestApp().app).post("/healthz")).status).toBe(405);
  });

  it("never touches the database", async () => {
    const { app, database } = makeTestApp({ database: new FakeDatabase(false) });
    expect((await request(app).get("/healthz")).status).toBe(200);
    expect(database.pings).toBe(0);
  });
});

describe("GET /readyz", () => {
  it("answers ready when the database responds", async () => {
    const { app, database } = makeTestApp();

    const res = await request(app).get("/readyz");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
    expect(database.pings).toBe(1);
  });

  it("answers 503 when the database is unavailable", async () => {
    const res = await request(makeTestApp({ database: new FakeDatabase(false) }).app).get(
      "/readyz",
    );
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable" });
  });
});
