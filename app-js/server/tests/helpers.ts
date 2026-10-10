import type { Express } from "express";

import { createApp } from "../src/app.js";
import { ChaosInjector } from "../src/chaos.js";
import { loadSettings, type LogLevel, type Settings } from "../src/config.js";
import { createLogger, type Logger } from "../src/logging.js";
import { Metrics } from "../src/metrics.js";
import { FakeDatabase, FakeLinkRepository } from "./fakes.js";

export const VALID_ENV: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://user:pw@db.invalid:5432/shortener",
  APP_ENV: "test",
  APP_VERSION: "1.2.3",
  GIT_SHA: "abc1234",
  PUBLIC_BASE_URL: "https://sho.rt",
};

/** Build Settings from a valid baseline, overridable per test (keys are env var names). */
export function makeSettings(overrides: Record<string, string | undefined> = {}): Settings {
  return loadSettings({ ...VALID_ENV, ...overrides });
}

export type LogLine = Record<string, unknown> & { level: string; logger: string; message: string };

/** A logger whose JSON lines are parsed into `lines` synchronously. */
export function captureLogger(level: LogLevel = "DEBUG"): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = createLogger(level, {
    write: (chunk: string) => {
      lines.push(JSON.parse(chunk) as LogLine);
    },
  });
  return { logger, lines };
}

export interface TestApp {
  app: Express;
  settings: Settings;
  database: FakeDatabase;
  repo: FakeLinkRepository;
  metrics: Metrics;
  chaos: ChaosInjector;
  logs: LogLine[];
}

/** App wired to in-memory fakes: unit tests never need a database. No UI unless `webDir`. */
export function makeTestApp(
  overrides: Partial<Pick<TestApp, "settings" | "database" | "repo">> & {
    env?: Record<string, string>;
    webDir?: string | null;
    rng?: () => number;
  } = {},
): TestApp {
  const settings = overrides.settings ?? makeSettings(overrides.env);
  const database = overrides.database ?? new FakeDatabase();
  const repo = overrides.repo ?? new FakeLinkRepository();
  const metrics = new Metrics(settings);
  const chaos = new ChaosInjector(settings.chaosErrorRate, overrides.rng);
  const { logger, lines } = captureLogger();
  const app = createApp({
    settings,
    database,
    repository: repo,
    logger,
    metrics,
    chaos,
    webDir: overrides.webDir ?? null,
  });
  return { app, settings, database, repo, metrics, chaos, logs: lines };
}

/** An ISO timestamp `ms` milliseconds from now. */
export const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();
