/** Build metadata and metrics. */

import { Router } from "express";

import type { AppContext } from "../app.js";
import { methodNotAllowed } from "../http.js";

export function metaRouter({ settings, metrics }: AppContext): Router {
  const router = Router();

  // Identify the running build (used to verify canary releases).
  router
    .route("/version")
    .get((_req, res) => {
      res.json({
        version: settings.appVersion,
        git_sha: settings.gitSha,
        environment: settings.appEnv,
      });
    })
    .all(methodNotAllowed("GET"));

  // Prometheus exposition format.
  router
    .route("/metrics")
    .get(async (_req, res) => {
      res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
    })
    .all(methodNotAllowed("GET"));

  return router;
}
