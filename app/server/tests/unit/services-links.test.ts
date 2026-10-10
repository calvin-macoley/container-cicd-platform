import { describe, expect, it } from "vitest";

import * as service from "../../src/services/links.js";
import { FakeLinkRepository } from "../fakes.js";

const NOW = new Date("2026-01-01T00:00:00Z");
const BASE = "https://sho.rt";

function create(repo: FakeLinkRepository, params: Partial<service.CreateLinkParams> = {}) {
  return service.createLink(repo, {
    targetUrl: "https://example.com/page",
    alias: null,
    expiresAt: null,
    publicBase: BASE,
    now: NOW,
    ...params,
  });
}

describe("generateCode", () => {
  it("produces distinct 7-character alphanumeric codes", () => {
    const codes = new Set(Array.from({ length: 200 }, service.generateCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{7}$/);
  });
});

describe("createLink", () => {
  it("creates with a generated code", async () => {
    const repo = new FakeLinkRepository();
    const record = await create(repo);
    expect(record.code).toHaveLength(service.GENERATED_CODE_LENGTH);
    expect(repo.links.get(record.code)?.targetUrl).toBe("https://example.com/page");
  });

  it("creates with an alias", async () => {
    expect((await create(new FakeLinkRepository(), { alias: "my-link" })).code).toBe("my-link");
  });

  it("rejects a taken alias", async () => {
    const repo = new FakeLinkRepository();
    await create(repo, { alias: "taken" });
    await expect(create(repo, { alias: "taken" })).rejects.toBeInstanceOf(
      service.AliasConflictError,
    );
  });

  it.each(["api", "assets", "healthz", "METRICS", "version", "readyz", "docs"])(
    "rejects reserved alias %s",
    async (alias) => {
      await expect(create(new FakeLinkRepository(), { alias })).rejects.toThrow(
        new service.InvalidLinkError(`alias '${alias}' is reserved`),
      );
    },
  );

  it("rejects a URL pointing at the shortener itself", async () => {
    await expect(
      create(new FakeLinkRepository(), { targetUrl: "https://SHO.RT/abc" }),
    ).rejects.toThrow("must not point at this shortener");
  });

  it.each([0, -1000])("rejects an expiry %d ms from now", async (delta) => {
    await expect(
      create(new FakeLinkRepository(), { expiresAt: new Date(NOW.getTime() + delta) }),
    ).rejects.toThrow("future");
  });

  it("retries generated codes on collision and skips reserved ones", async () => {
    const repo = new FakeLinkRepository();
    await create(repo, { alias: "aaaaaaa" });
    const codes = ["aaaaaaa", "healthz", "bbbbbbb"][Symbol.iterator]();

    const record = await create(repo, { generate: () => codes.next().value ?? "" });

    expect(record.code).toBe("bbbbbbb");
    expect(repo.createCalls).toEqual(["aaaaaaa", "aaaaaaa", "bbbbbbb"]); // reserved never tried
  });

  it("gives up after MAX_GENERATE_ATTEMPTS", async () => {
    const repo = new FakeLinkRepository();
    await create(repo, { alias: "sameeee" });
    await expect(create(repo, { generate: () => "sameeee" })).rejects.toBeInstanceOf(
      service.CodeGenerationError,
    );
    expect(repo.createCalls).toHaveLength(1 + service.MAX_GENERATE_ATTEMPTS);
  });
});

describe("resolveLink", () => {
  it("counts clicks", async () => {
    const repo = new FakeLinkRepository();
    const { code } = await create(repo);

    expect(await service.resolveLink(repo, code)).toBe("https://example.com/page");
    await service.resolveLink(repo, code);

    expect(repo.links.get(code)?.clickCount).toBe(2);
    expect(repo.links.get(code)?.lastClickedAt).not.toBeNull();
  });

  it("rejects a missing link", async () => {
    await expect(service.resolveLink(new FakeLinkRepository(), "nope")).rejects.toBeInstanceOf(
      service.LinkNotFoundError,
    );
  });

  it("treats an expired link as missing and does not count it", async () => {
    let now = NOW;
    const repo = new FakeLinkRepository(() => now);
    const { code } = await create(repo, { expiresAt: new Date(NOW.getTime() + 5 * 60_000) });
    now = new Date(NOW.getTime() + 5 * 60_000);

    await expect(service.resolveLink(repo, code)).rejects.toBeInstanceOf(service.LinkNotFoundError);
    expect(repo.links.get(code)?.clickCount).toBe(0);
  });
});

describe("peekLink", () => {
  it("returns the target without counting", async () => {
    const repo = new FakeLinkRepository();
    const { code } = await create(repo);
    expect(await service.peekLink(repo, code)).toBe("https://example.com/page");
    expect(repo.links.get(code)?.clickCount).toBe(0);
  });
});

describe("getLink", () => {
  it("includes expired links", async () => {
    let now = NOW;
    const repo = new FakeLinkRepository(() => now);
    const { code } = await create(repo, { expiresAt: new Date(NOW.getTime() + 1000) });
    now = new Date(NOW.getTime() + 86_400_000);

    expect((await service.getLink(repo, code)).code).toBe(code);
  });

  it("rejects a missing link", async () => {
    await expect(service.getLink(new FakeLinkRepository(), "nope")).rejects.toBeInstanceOf(
      service.LinkNotFoundError,
    );
  });
});

describe("deleteLink", () => {
  it("deletes once, then reports not found", async () => {
    const repo = new FakeLinkRepository();
    const { code } = await create(repo);
    await service.deleteLink(repo, code);
    expect(repo.links.has(code)).toBe(false);
    await expect(service.deleteLink(repo, code)).rejects.toBeInstanceOf(service.LinkNotFoundError);
  });
});
