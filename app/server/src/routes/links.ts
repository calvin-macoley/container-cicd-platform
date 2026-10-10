/** Link management API (/api/links). */

import express, { Router } from "express";

import type { AppContext } from "../app.js";
import { injectChaos } from "../chaos.js";
import { child } from "../logging.js";
import { HttpError, methodNotAllowed, parseBody } from "../http.js";
import { linkCreateSchema, toLinkResponse } from "../schemas.js";
import * as service from "../services/links.js";

const NOT_FOUND = "Link not found";

function rethrowNotFound(error: unknown): never {
  if (error instanceof service.LinkNotFoundError) throw new HttpError(404, NOT_FOUND);
  throw error;
}

export function linksRouter({ settings, repository, chaos, logger }: AppContext): Router {
  const router = Router();
  const log = child(logger, "routes.links");
  // Chaos applies to every /api/* route (see chaos.ts).
  const chaosFirst = injectChaos(chaos, child(logger, "chaos"));
  // Full paths (not a mount prefix) so every top-level route is visible to the
  // reserved-codes test.
  router.use("/api/links", express.json());

  router
    .route("/api/links")
    .post(chaosFirst, async (req, res) => {
      const body = parseBody(linkCreateSchema, req.body);
      const now = new Date();
      let record;
      try {
        record = await service.createLink(repository, {
          targetUrl: body.url,
          alias: body.alias,
          expiresAt: body.expires_at,
          publicBase: settings.publicBase,
          now,
        });
      } catch (error) {
        if (error instanceof service.InvalidLinkError) throw new HttpError(422, error.message);
        if (error instanceof service.AliasConflictError) {
          throw new HttpError(409, "Alias already in use");
        }
        if (error instanceof service.CodeGenerationError) {
          log.error({ attempts: service.MAX_GENERATE_ATTEMPTS }, "could not generate a free code");
          throw new HttpError(503, "Could not allocate a short code; retry");
        }
        throw error;
      }
      res
        .status(201)
        .location(`/api/links/${record.code}`)
        .json(toLinkResponse(record, settings.publicBase, now));
    })
    .all(methodNotAllowed("POST"));

  router
    .route("/api/links/:code")
    .get(chaosFirst, async (req, res) => {
      const record = await service.getLink(repository, req.params.code).catch(rethrowNotFound);
      res.json(toLinkResponse(record, settings.publicBase, new Date()));
    })
    .delete(chaosFirst, async (req, res) => {
      await service.deleteLink(repository, req.params.code).catch(rethrowNotFound);
      res.status(204).end();
    })
    .all(methodNotAllowed("GET", "DELETE"));

  return router;
}
