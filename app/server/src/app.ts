/** Application factory. */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express, type RequestHandler } from "express";

import { ChaosInjector } from "./chaos.js";
import type { Settings } from "./config.js";
import type { DatabaseProbe } from "./db.js";
import { errorHandler, methodNotAllowed, notFound } from "./http.js";
import { child, type Logger } from "./logging.js";
import { Metrics } from "./metrics.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { requestId } from "./middleware/request-id.js";
import type { LinkRepository } from "./repository.js";
import { healthRouter } from "./routes/health.js";
import { linksRouter } from "./routes/links.js";
import { metaRouter } from "./routes/meta.js";
import { redirectRouter } from "./routes/redirect.js";

/**
 * The built web UI: web/dist next to server/ in both the source tree and the
 * image (server/src or server/dist -> ../../web/dist).
 */
export const DEFAULT_WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

/** The built UI if present; a server run before `npm run build -w web` serves the API only. */
function defaultWebDir(): string | null {
  return existsSync(join(DEFAULT_WEB_DIR, "index.html")) ? DEFAULT_WEB_DIR : null;
}

/** What main.ts (or a test) provides. */
export interface AppDeps {
  readonly settings: Settings;
  readonly database: DatabaseProbe;
  readonly repository: LinkRepository;
  readonly logger: Logger;
  /** Defaults to one built from settings. */
  readonly metrics?: Metrics;
  /** Defaults to CHAOS_ERROR_RATE with Math.random. */
  readonly chaos?: ChaosInjector;
  /** Built UI directory; null serves no UI. Defaults to DEFAULT_WEB_DIR when it exists. */
  readonly webDir?: string | null;
}

/** Everything the routers receive. */
export interface AppContext extends AppDeps {
  readonly metrics: Metrics;
  readonly chaos: ChaosInjector;
}

/** Log the startup line, and warn loudly if chaos is on. */
export function logStartup(logger: Logger, settings: Settings): void {
  logger.info(
    { environment: settings.appEnv, version: settings.appVersion, git_sha: settings.gitSha },
    "starting",
  );
  if (settings.chaosErrorRate > 0) {
    logger.warn(
      { chaos_error_rate: settings.chaosErrorRate },
      "chaos enabled: a fraction of /api/* requests will fail on purpose",
    );
  }
}

/** Serve the single-page UI at / and its hashed bundles under /assets. */
function webUi(webDir: string): express.Router {
  const router = express.Router();
  const label =
    (template: string): RequestHandler =>
    (_req, res, next) => {
      res.locals.routeTemplate = template;
      next();
    };

  // File names carry a content hash, so they can be cached forever.
  router.use(
    "/assets",
    label("/assets/*"),
    express.static(join(webDir, "assets"), { immutable: true, maxAge: "1y", index: false }),
  );
  router
    .route("/")
    .get((_req, res) => {
      // Always revalidate: a new release must reach browsers immediately.
      res.set("Cache-Control", "no-cache").sendFile(join(webDir, "index.html"));
    })
    .all(methodNotAllowed("GET"));
  return router;
}

export function createApp(deps: AppDeps): Express {
  const ctx: AppContext = {
    ...deps,
    metrics: deps.metrics ?? new Metrics(deps.settings),
    chaos: deps.chaos ?? new ChaosInjector(deps.settings.chaosErrorRate),
  };
  const webDir = deps.webDir === undefined ? defaultWebDir() : deps.webDir;

  const app = express();
  app.disable("x-powered-by");

  // Order: request ID -> metrics/access log -> routes -> error handler.
  app.use(requestId);
  app.use(metricsMiddleware(ctx.metrics, child(ctx.logger, "access")));

  app.use(healthRouter(ctx));
  app.use(metaRouter(ctx));
  app.use(linksRouter(ctx));
  if (webDir) app.use(webUi(webDir));
  app.use(redirectRouter(ctx)); // catch-all /:code: must stay last

  app.use(notFound);
  app.use(errorHandler(ctx.logger));
  return app;
}
