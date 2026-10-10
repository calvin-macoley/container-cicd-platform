import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { ConfigError, loadDbSettings, loadSettings } from "../../src/config.js";
import { makeSettings, VALID_ENV } from "../helpers.js";

describe("loadSettings", () => {
  it("loads settings from the environment", () => {
    const settings = loadSettings({ ...VALID_ENV, PORT: "9000", LOG_LEVEL: "debug" });

    expect(settings.appEnv).toBe("test");
    expect(settings.appVersion).toBe("1.2.3");
    expect(settings.gitSha).toBe("abc1234");
    expect(settings.port).toBe(9000);
    expect(settings.logLevel).toBe("DEBUG");
    expect(settings.chaosErrorRate).toBe(0);
    expect(settings.publicBase).toBe("https://sho.rt");
  });

  it("applies defaults", () => {
    const settings = makeSettings();
    expect(settings.port).toBe(8000);
    expect(settings.logLevel).toBe("INFO");
    expect(settings.shutdownTimeoutSeconds).toBe(20);
    expect(settings.readinessTimeoutSeconds).toBe(2);
    expect(settings.chaosAllowInProd).toBe(false);
    expect(settings.dbPoolMax).toBe(10);
  });

  it("treats variable names case-insensitively", () => {
    const lower = Object.fromEntries(
      Object.entries(VALID_ENV).map(([key, value]) => [key.toLowerCase(), value]),
    );
    expect(loadSettings(lower).appVersion).toBe("1.2.3");
  });

  it.each(["DATABASE_URL", "APP_ENV", "APP_VERSION", "GIT_SHA", "PUBLIC_BASE_URL"])(
    "fails with a clear error when %s is missing",
    (missing) => {
      const env = { ...VALID_ENV, [missing]: undefined };
      expect(() => loadSettings(env)).toThrow(ConfigError);
      expect(() => loadSettings(env)).toThrow(
        `${missing}: required environment variable is not set`,
      );
    },
  );

  it("reports every invalid variable at once", () => {
    const run = () => loadSettings({ ...VALID_ENV, PORT: "0", GIT_SHA: "nope" });
    expect(run).toThrow(/^ {2}PORT: /m);
    expect(run).toThrow(/^ {2}GIT_SHA: /m);
  });

  it("does not leak DATABASE_URL in errors", () => {
    let message = "";
    try {
      loadSettings({ ...VALID_ENV, DATABASE_URL: "mysql://u:hunter2@h/db" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("hunter2");
  });

  it.each([
    "postgresql://u:p@h:5432/d",
    "postgres://u:p@h:5432/d",
    "postgresql+asyncpg://u:p@h:5432/d",
  ])("normalises %s to postgresql://", (url) => {
    expect(makeSettings({ DATABASE_URL: url }).connectionString.reveal()).toBe(
      "postgresql://u:p@h:5432/d",
    );
  });

  it("keeps the database URL secret", () => {
    const settings = makeSettings();
    expect(inspect(settings)).not.toContain("pw");
    expect(JSON.stringify(settings)).not.toContain("pw");
    expect(String(settings.databaseUrl)).not.toContain("pw");
  });

  it.each(["xyz1234", "abc12", "a".repeat(41), ""])("rejects git sha %j", (sha) => {
    expect(() => makeSettings({ GIT_SHA: sha })).toThrow(ConfigError);
  });

  it("lowercases the git sha", () => {
    expect(makeSettings({ GIT_SHA: "ABCDEF0" }).gitSha).toBe("abcdef0");
  });

  it("rejects an unknown environment", () => {
    expect(() => makeSettings({ APP_ENV: "production" })).toThrow(ConfigError);
  });

  it("rejects a blank version", () => {
    expect(() => makeSettings({ APP_VERSION: "  " })).toThrow(ConfigError);
  });

  it.each(["", "abc", "1.5", "0", "70000"])("rejects port %j", (port) => {
    expect(() => makeSettings({ PORT: port })).toThrow(ConfigError);
  });

  it.each(["ftp://sho.rt", "not a url"])("rejects public base url %j", (url) => {
    expect(() => makeSettings({ PUBLIC_BASE_URL: url })).toThrow(ConfigError);
  });

  it("strips the trailing slash from the public base url", () => {
    expect(makeSettings({ PUBLIC_BASE_URL: "https://sho.rt/" }).publicBase).toBe("https://sho.rt");
  });

  it.each(["-0.1", "1.1"])("rejects chaos rate %s", (rate) => {
    expect(() => makeSettings({ CHAOS_ERROR_RATE: rate })).toThrow(ConfigError);
  });

  it("refuses chaos in prod", () => {
    expect(() => makeSettings({ APP_ENV: "prod", CHAOS_ERROR_RATE: "0.1" })).toThrow(
      /refused when APP_ENV=prod.*CHAOS_ALLOW_IN_PROD/,
    );
  });

  it.each(["true", "TRUE", "1", "yes", "on"])("allows chaos in prod with override %s", (flag) => {
    const settings = makeSettings({
      APP_ENV: "prod",
      CHAOS_ERROR_RATE: "0.2",
      CHAOS_ALLOW_IN_PROD: flag,
    });
    expect(settings.chaosErrorRate).toBe(0.2);
  });

  it("rejects a non-boolean override", () => {
    expect(() => makeSettings({ CHAOS_ALLOW_IN_PROD: "maybe" })).toThrow(ConfigError);
  });

  it("accepts zero chaos in prod", () => {
    expect(makeSettings({ APP_ENV: "prod" }).chaosErrorRate).toBe(0);
  });

  it("allows chaos outside prod", () => {
    expect(makeSettings({ APP_ENV: "staging", CHAOS_ERROR_RATE: "0.5" }).chaosErrorRate).toBe(0.5);
  });
});

describe("loadDbSettings", () => {
  it("only needs DATABASE_URL", () => {
    expect(
      loadDbSettings({ DATABASE_URL: "postgresql+asyncpg://u:p@h/d" }).connectionString.reveal(),
    ).toBe("postgresql://u:p@h/d");
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => loadDbSettings({})).toThrow(/DATABASE_URL/);
  });
});
