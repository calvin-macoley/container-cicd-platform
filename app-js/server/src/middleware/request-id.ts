/** Attach a request ID to every request, its log lines, and its response. */

import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import { requestContext } from "../logging.js";

export const HEADER = "X-Request-ID";
// Accept caller-supplied IDs only if they are short and log-safe.
const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(incoming: string | undefined): string {
  if (incoming && VALID_ID.test(incoming)) return incoming;
  return randomUUID().replaceAll("-", "");
}

export const requestId: RequestHandler = (req, res, next) => {
  const id = resolveRequestId(req.get(HEADER));
  res.locals.requestId = id;
  res.set(HEADER, id);
  requestContext.run({ requestId: id }, next);
};
