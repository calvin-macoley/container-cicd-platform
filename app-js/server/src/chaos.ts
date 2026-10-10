/**
 * Deliberate failure injection for canary-rollback demos.
 *
 * When CHAOS_ERROR_RATE > 0, that fraction of /api/* requests returns 500
 * before the handler runs. It is the first handler on each /api route rather
 * than an app-wide middleware, so the route is already matched and the failure
 * is recorded under its real route template in metrics. Health, version,
 * metrics, UI and redirect endpoints are never affected. Refused in prod unless
 * CHAOS_ALLOW_IN_PROD=true (enforced in config.ts).
 */

import type { RequestHandler } from "express";

import { HttpError } from "./http.js";
import type { Logger } from "./logging.js";

export const CHAOS_DETAIL = "Injected failure (chaos)";

export class ChaosInjector {
  constructor(
    public rate: number,
    // Not security-sensitive; injectable for tests.
    public rng: () => number = Math.random,
  ) {}

  shouldFail(): boolean {
    return this.rate > 0 && this.rng() < this.rate;
  }
}

/** Route handler: fail this request on purpose, at the configured rate. */
export function injectChaos(injector: ChaosInjector, logger: Logger): RequestHandler {
  return (_req, _res, next) => {
    if (injector.shouldFail()) {
      logger.warn({ chaos: true }, "chaos: injected failure");
      throw new HttpError(500, CHAOS_DETAIL);
    }
    next();
  };
}
