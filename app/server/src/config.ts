/**
 * Application configuration.
 *
 * Every setting comes from environment variables and is validated once at
 * startup. This is the only module that reads the environment.
 *
 * Two loaders exist so that the migration command only needs the database URL:
 *
 * - `loadDbSettings()`: used by migrations.
 * - `loadSettings()`: everything the HTTP service needs.
 *
 * Variable names and rules match the Python service (see .env.example), so the
 * same deploy configuration works for either implementation.
 */

import { inspect } from "node:util";
import { z } from "zod";

export const ENVIRONMENTS = ["local", "test", "staging", "qa", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Holds a sensitive value without exposing it through logging, JSON or util.inspect. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "**********";
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return `Secret(${this.toString()})`;
  }
}

export interface DbSettings {
  /** DATABASE_URL as given. */
  readonly databaseUrl: Secret;
  /** DATABASE_URL rewritten to the plain postgresql:// scheme node-postgres expects. */
  readonly connectionString: Secret;
  readonly dbPoolSize: number;
  readonly dbMaxOverflow: number;
  /** node-postgres has a single pool limit: DB_POOL_SIZE + DB_MAX_OVERFLOW. */
  readonly dbPoolMax: number;
}

export interface Settings extends DbSettings {
  readonly appEnv: Environment;
  readonly appVersion: string;
  readonly gitSha: string;
  /** PUBLIC_BASE_URL without a trailing slash. */
  readonly publicBase: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly readinessTimeoutSeconds: number;
  readonly shutdownTimeoutSeconds: number;
  readonly chaosErrorRate: number;
  readonly chaosAllowInProd: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

// --- Field schemas -----------------------------------------------------------

const PG_SCHEME = "postgresql://";
const ACCEPTED_SCHEMES = [PG_SCHEME, "postgres://", "postgresql+asyncpg://"] as const;

/** Parses a number from an env string; blank strings stay strings so they fail validation. */
const num = (schema: z.ZodNumber) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), schema);

const TRUE_VALUES = new Set(["1", "true", "t", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "f", "no", "n", "off"]);

const bool = z.string().transform((value, ctx) => {
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  ctx.addIssue({ code: "custom", message: "must be a boolean (true/false)" });
  return z.NEVER;
});

const databaseUrl = z
  .string()
  .refine((raw) => ACCEPTED_SCHEMES.some((scheme) => raw.startsWith(scheme)), {
    message: "must be a PostgreSQL URL (postgresql:// or postgresql+asyncpg://)",
  });

const nonEmpty = z
  .string()
  .trim()
  .min(1, { message: "must not be blank" })
  .max(64, { message: "must be at most 64 characters" });

const gitSha = z
  .string()
  .regex(/^[0-9a-fA-F]{7,40}$/, { message: "must be 7-40 hexadecimal characters" })
  .transform((sha) => sha.toLowerCase());

const httpUrl = z.string().refine(
  (raw) => {
    try {
      const { protocol } = new URL(raw);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an http(s) URL" },
);

const dbShape = {
  DATABASE_URL: databaseUrl,
  DB_POOL_SIZE: num(z.number().int().min(1).max(100)).default(5),
  DB_MAX_OVERFLOW: num(z.number().int().min(0).max(100)).default(5),
};

const dbSchema = z.object(dbShape);

const settingsSchema = z
  .object({
    ...dbShape,
    APP_ENV: z.enum(ENVIRONMENTS),
    APP_VERSION: nonEmpty,
    GIT_SHA: gitSha,
    PUBLIC_BASE_URL: httpUrl,
    PORT: num(z.number().int().min(1).max(65535)).default(8000),
    LOG_LEVEL: z
      .string()
      .transform((level) => level.toUpperCase())
      .pipe(z.enum(LOG_LEVELS))
      .default("INFO"),
    READINESS_TIMEOUT_SECONDS: num(z.number().gt(0).max(30)).default(2),
    SHUTDOWN_TIMEOUT_SECONDS: num(z.number().int().min(1).max(300)).default(20),
    CHAOS_ERROR_RATE: num(z.number().min(0).max(1)).default(0),
    CHAOS_ALLOW_IN_PROD: bool.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "prod" && env.CHAOS_ERROR_RATE > 0 && !env.CHAOS_ALLOW_IN_PROD) {
      ctx.addIssue({
        code: "custom",
        message:
          "CHAOS_ERROR_RATE > 0 is refused when APP_ENV=prod; " +
          "set CHAOS_ALLOW_IN_PROD=true to override deliberately",
      });
    }
  });

// --- Loading -----------------------------------------------------------------

/** Variable names are case-insensitive, as in the Python service. */
function normaliseEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key.toUpperCase()] = value;
  }
  return out;
}

function formatErrors(error: z.ZodError, env: Record<string, string>): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.map(String).join(".");
    if (!name) return `  settings: ${issue.message}`;
    if (env[name] === undefined) return `  ${name}: required environment variable is not set`;
    // Never echo the value: DATABASE_URL carries a password.
    return `  ${name}: ${issue.message}`;
  });
  return ["Invalid configuration:", ...lines].join("\n");
}

function parse<S extends z.ZodType>(schema: S, rawEnv: Env): z.output<S> {
  const env = normaliseEnv(rawEnv);
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigError(formatErrors(result.error, env));
  return result.data;
}

function toDbSettings(env: z.output<typeof dbSchema>): DbSettings {
  const raw = env.DATABASE_URL;
  const scheme = ACCEPTED_SCHEMES.find((s) => raw.startsWith(s)) ?? PG_SCHEME;
  return {
    databaseUrl: new Secret(raw),
    connectionString: new Secret(PG_SCHEME + raw.slice(scheme.length)),
    dbPoolSize: env.DB_POOL_SIZE,
    dbMaxOverflow: env.DB_MAX_OVERFLOW,
    dbPoolMax: env.DB_POOL_SIZE + env.DB_MAX_OVERFLOW,
  };
}

/** Read and validate Settings from the environment, failing with a readable error. */
export function loadSettings(env: Env = process.env): Settings {
  const parsed = parse(settingsSchema, env);
  return Object.freeze({
    ...toDbSettings(parsed),
    appEnv: parsed.APP_ENV,
    appVersion: parsed.APP_VERSION,
    gitSha: parsed.GIT_SHA,
    publicBase: new URL(parsed.PUBLIC_BASE_URL).toString().replace(/\/+$/, ""),
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    readinessTimeoutSeconds: parsed.READINESS_TIMEOUT_SECONDS,
    shutdownTimeoutSeconds: parsed.SHUTDOWN_TIMEOUT_SECONDS,
    chaosErrorRate: parsed.CHAOS_ERROR_RATE,
    chaosAllowInProd: parsed.CHAOS_ALLOW_IN_PROD,
  });
}

/** Read and validate DbSettings from the environment. */
export function loadDbSettings(env: Env = process.env): DbSettings {
  return Object.freeze(toDbSettings(parse(dbSchema, env)));
}
