/** Public short-link redirect: GET and HEAD /:code. Mounted last (catch-all). */

import { Router, type Response } from "express";

import type { AppContext } from "../app.js";
import { HttpError, methodNotAllowed } from "../http.js";
import type { LinkRepository } from "../repository.js";
import * as service from "../services/links.js";

const NOT_FOUND = "Link not found";

type Lookup = (repo: LinkRepository, code: string) => Promise<string>;

async function redirectTo(
  res: Response,
  code: string,
  repo: LinkRepository,
  lookup: Lookup,
): Promise<void> {
  // Paths that can never be a code (e.g. /favicon.ico) skip the database.
  if (!service.ALIAS_PATTERN.test(code) || service.isReserved(code)) {
    throw new HttpError(404, NOT_FOUND);
  }
  let target: string;
  try {
    target = await lookup(repo, code);
  } catch (error) {
    if (error instanceof service.LinkNotFoundError) throw new HttpError(404, NOT_FOUND);
    throw error;
  }
  // no-store: every visit must reach us so the click is counted.
  res.set("Cache-Control", "no-store").redirect(307, target);
}

export function redirectRouter({ repository }: AppContext): Router {
  const router = Router();

  router
    .route("/:code")
    // Same response as GET, without counting a click (link checkers, unfurlers).
    // Registered before GET, which Express would otherwise also use for HEAD.
    .head(async (req, res) => {
      await redirectTo(res, req.params.code, repository, service.peekLink);
    })
    // Follow a short link and count the click.
    .get(async (req, res) => {
      await redirectTo(res, req.params.code, repository, service.resolveLink);
    })
    .all(methodNotAllowed("GET", "HEAD"));

  return router;
}
