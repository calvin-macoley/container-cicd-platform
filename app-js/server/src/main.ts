/**
 * Container entrypoint: `node dist/main.js`.
 *
 * Validates configuration, configures JSON logging, then serves on
 * 0.0.0.0:$PORT. On SIGTERM (or SIGINT) the server stops accepting
 * connections and lets in-flight requests finish, up to
 * SHUTDOWN_TIMEOUT_SECONDS, then closes database connections and exits.
 *
 * Exit codes: 0 = clean shutdown, 78 = invalid configuration, other = crash.
 */

import { createApp, logStartup } from "./app.js";
import { ConfigError, loadSettings, type Settings } from "./config.js";
import { Database } from "./db.js";
import { child, createLogger, type Logger } from "./logging.js";
import { SqlLinkRepository } from "./repository.js";

const EXIT_CONFIG_ERROR = 78; // EX_CONFIG from sysexits.h

function serve(settings: Settings, logger: Logger): void {
  const database = Database.fromSettings(settings, child(logger, "db"));
  const app = createApp({
    settings,
    logger,
    database,
    repository: new SqlLinkRepository(database.db),
  });
  // 0.0.0.0: must be reachable from outside the container.
  const server = app.listen(settings.port, "0.0.0.0", () => {
    logStartup(logger, settings);
  });

  const exit = (code: number): void => {
    logger.flush(() => process.exit(code));
  };

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "shutting down");
    const deadline = setTimeout(() => {
      logger.warn("shutdown timeout reached, closing remaining connections");
      server.closeAllConnections();
    }, settings.shutdownTimeoutSeconds * 1000);
    deadline.unref();
    server.close(() => {
      database
        .close()
        .catch((error: unknown) => logger.error({ exc_info: error }, "closing the database failed"))
        .finally(() => {
          logger.info("stopped");
          exit(0);
        });
    });
    server.closeIdleConnections();
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function main(): void {
  let settings: Settings;
  try {
    settings = loadSettings();
  } catch (error) {
    if (error instanceof ConfigError) {
      const logger = createLogger("INFO");
      logger.fatal(error.message);
      logger.flush(() => process.exit(EXIT_CONFIG_ERROR));
      return;
    }
    throw error;
  }
  serve(settings, createLogger(settings.logLevel));
}

main();
