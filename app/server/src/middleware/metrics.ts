/** Record Prometheus metrics and write one access log line per request. */

import type { RequestHandler } from "express";

import type { Logger } from "../logging.js";
import { methodLabel, routeTemplate, type Metrics } from "../metrics.js";

// Probe and scrape traffic is logged at DEBUG to keep INFO logs readable.
const QUIET_ROUTES = new Set(["/healthz", "/readyz", "/metrics"]);

export function metricsMiddleware(metrics: Metrics, accessLogger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    // "close" fires once per response, after "finish" or when the client goes away.
    res.once("close", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = routeTemplate(req, res);
      const method = methodLabel(req.method);
      // An aborted request that never got a response counts as a server-side failure.
      const status = res.headersSent ? res.statusCode : 500;
      metrics.observe(method, route, status, seconds);
      const fields = {
        // Explicit: "close" runs outside the request's async context.
        request_id: res.locals.requestId as string | undefined,
        method,
        route,
        // Full path: req.path is relative to the router a request was mounted on.
        path: req.originalUrl.split("?")[0],
        status,
        duration_ms: Math.round(seconds * 100_000) / 100,
      };
      if (QUIET_ROUTES.has(route)) accessLogger.debug(fields, "request");
      else accessLogger.info(fields, "request");
    });
    next();
  };
}
