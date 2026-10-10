/**
 * Structured JSON logging to stdout, with the current request ID on every line.
 *
 * Lines keep the Python service's shape so log queries work for either:
 * {"timestamp", "level", "logger", "message", "request_id", ...extra}.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { pino, type DestinationStream, type Logger } from "pino";

import type { LogLevel } from "./config.js";

export type { Logger };

interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// The logger name lives on the instance, not in pino bindings: child bindings
// would stack a second "logger" key onto every line instead of replacing it.
const NAME = Symbol("logger name");
type Named = Logger & { [NAME]?: string };

const PINO_LEVEL: Record<LogLevel, pino.Level> = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warn",
  ERROR: "error",
};

const LEVEL_NAME: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

/** Root logger named "shortener". Pass `destination` to capture output (tests). */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level: PINO_LEVEL[level],
      base: null,
      messageKey: "message",
      errorKey: "exc_info",
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: LEVEL_NAME[label] ?? label.toUpperCase() }) },
      // Explicit request_id fields in a log call win over the context's.
      mixin: (_merge, _level, logger) => ({
        logger: (logger as Named)[NAME] ?? "shortener",
        request_id: requestContext.getStore()?.requestId ?? null,
      }),
    },
    destination ?? pino.destination({ dest: 1, sync: false }),
  );
}

/** A named child logger, e.g. "shortener.access". */
export function child(logger: Logger, name: string): Logger {
  const named: Named = logger.child({});
  named[NAME] = `shortener.${name}`;
  return named;
}
