import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createLink, deleteLink, extractCode, getLink } from "./api";
import { json, LINK, mockFetch } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

describe("createLink", () => {
  it("posts only the fields that are set", async () => {
    const fetchMock = mockFetch(() => json(201, LINK));

    await createLink({ url: "https://example.com", alias: "", expiresAt: undefined });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/links");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ url: "https://example.com" });
  });

  it("sends expiry as an ISO timestamp with a timezone", async () => {
    const fetchMock = mockFetch(() => json(201, LINK));
    await createLink({
      url: "https://example.com",
      alias: "x-1",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      url: "https://example.com",
      alias: "x-1",
      expires_at: "2030-01-01T00:00:00.000Z",
    });
  });

  it("maps validation issues to fields", async () => {
    mockFetch(() =>
      json(422, {
        detail: [
          { type: "custom", loc: ["body", "url"], msg: "must be an http(s) URL with a host" },
          { type: "invalid_format", loc: ["body", "alias"], msg: "bad alias" },
        ],
      }),
    );
    const error = await createLink({ url: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual({
      url: "must be an http(s) URL with a host",
      alias: "bad alias",
    });
  });

  it("passes business-rule messages through", async () => {
    mockFetch(() => json(422, { detail: "expires_at must be in the future" }));
    await expect(createLink({ url: "https://example.com" })).rejects.toThrow(
      "expires_at must be in the future",
    );
  });

  it("flags the alias on conflict", async () => {
    mockFetch(() => json(409, { detail: "Alias already in use" }));
    const error = (await createLink({ url: "https://e.com", alias: "dup" }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.status).toBe(409);
    expect(error.fieldErrors.alias).toBeDefined();
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(createLink({ url: "https://example.com" })).rejects.toThrow(
      "Could not reach the server",
    );
  });

  it("handles non-JSON error bodies", async () => {
    mockFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(createLink({ url: "https://example.com" })).rejects.toThrow("HTTP 502");
  });
});

describe("getLink and deleteLink", () => {
  it("escape the code in the path", async () => {
    const fetchMock = mockFetch(() => json(200, LINK));
    await getLink("a b");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/links/a%20b");
  });

  it("delete resolves on 204", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(deleteLink("promo")).resolves.toBeUndefined();
  });
});

describe("extractCode", () => {
  it.each([
    ["promo", "promo"],
    ["  promo  ", "promo"],
    ["/promo/", "promo"],
    ["https://sho.rt/promo", "promo"],
    ["https://sho.rt/promo?utm=x", "promo"],
    ["", ""],
  ])("%j -> %j", (input, code) => {
    expect(extractCode(input)).toBe(code);
  });
});
