import request from "supertest";
import { describe, expect, it } from "vitest";

import { makeTestApp } from "../helpers.js";

describe("GET /version", () => {
  it("identifies the build", async () => {
    const res = await request(makeTestApp().app).get("/version");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: "1.2.3", git_sha: "abc1234", environment: "test" });
  });

  it("reflects settings exactly", async () => {
    const { app } = makeTestApp({
      env: { APP_ENV: "staging", APP_VERSION: "2.0.0-rc.1", GIT_SHA: "0123456789abcdef" },
    });
    const res = await request(app).get("/version");
    expect(res.body).toEqual({
      version: "2.0.0-rc.1",
      git_sha: "0123456789abcdef",
      environment: "staging",
    });
  });

  it("rejects other methods", async () => {
    expect((await request(makeTestApp().app).delete("/version")).status).toBe(405);
  });
});
