// Copy to app/server/tests/unit/routes-<name>.test.ts and fill in.
import request from "supertest";
import { describe, expect, it } from "vitest";

import { makeTestApp } from "../helpers.js";

describe("<METHOD> <path>", () => {
  it("succeeds", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/<path>");
    expect(res.status).toBe(200);
  });

  it("rejects invalid input with 422", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/<path>").send({});
    expect(res.status).toBe(422);
  });

  it("returns 404 when the resource does not exist", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/<path>/missing");
    expect(res.status).toBe(404);
  });
});
