/** Tests must never use DATABASE_URL; integration tests use TEST_DATABASE_URL only. */

import { describe, expect, it } from "vitest";

import { resolveTestDbSettings, TestDatabaseConfigError } from "../integration/db.js";

describe("resolveTestDbSettings", () => {
  it("disables integration tests when TEST_DATABASE_URL is unset", () => {
    expect(resolveTestDbSettings({ DATABASE_URL: "postgresql://u:p@h/real" })).toBeNull();
  });

  it("uses TEST_DATABASE_URL", () => {
    const settings = resolveTestDbSettings({
      TEST_DATABASE_URL: "postgresql+asyncpg://u:p@testdb:5432/scratch",
    });
    expect(settings?.connectionString.reveal()).toBe("postgresql://u:p@testdb:5432/scratch");
  });

  it.each([
    "postgresql://other:creds@db:5432/shortener",
    "postgresql+asyncpg://u:p@db/shortener",
    "postgres://u:p@db:5432/shortener",
  ])("refuses %s when it names the DATABASE_URL database", (testUrl) => {
    expect(() =>
      resolveTestDbSettings({
        DATABASE_URL: "postgresql://u:p@db:5432/shortener",
        TEST_DATABASE_URL: testUrl,
      }),
    ).toThrow(TestDatabaseConfigError);
  });

  it("allows a different database on the same server", () => {
    expect(
      resolveTestDbSettings({
        DATABASE_URL: "postgresql://u:p@db:5432/shortener",
        TEST_DATABASE_URL: "postgresql://u:p@db:5432/shortener_test",
      }),
    ).not.toBeNull();
  });

  it("rejects an invalid TEST_DATABASE_URL", () => {
    expect(() => resolveTestDbSettings({ TEST_DATABASE_URL: "mysql://u:p@h/d" })).toThrow(
      /TEST_DATABASE_URL is invalid/,
    );
  });
});
