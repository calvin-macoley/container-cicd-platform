/** Liveness and readiness probes. */

import { Router } from "express";

import type { AppContext } from "../app.js";
import { methodNotAllowed } from "../http.js";

export function healthRouter({ settings, database }: AppContext): Router {
  const router = Router();

  // Liveness: the process is up and serving HTTP. Never touches the database.
  router
    .route("/healthz")
    .get((_req, res) => {
      res.json({ status: "ok" });
    })
    .all(methodNotAllowed("GET"));

  // Readiness: the database answers within READINESS_TIMEOUT_SECONDS.
  router
    .route("/readyz")
    .get(async (_req, res) => {
      if (await database.ping(settings.readinessTimeoutSeconds)) {
        res.json({ status: "ready" });
      } else {
        res.status(503).json({ status: "unavailable" });
      }
    })
    .all(methodNotAllowed("GET"));

  return router;
}
