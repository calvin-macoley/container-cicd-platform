/**
 * HTTP error handling shared by all routes.
 *
 * Error bodies keep the Python service's shape so clients see no difference:
 * `{"detail": "<message>"}`, or for request validation errors
 * `{"detail": [{"type", "loc", "msg"}, ...]}` with status 422.
 */

import type { ErrorRequestHandler, RequestHandler } from "express";
import type { z } from "zod";

import type { Logger } from "./logging.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "HttpError";
  }
}

export interface ValidationIssue {
  type: string;
  loc: (string | number)[];
  msg: string;
}

export class RequestValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super("Request validation failed");
    this.name = "RequestValidationError";
  }
}

/** Parse a request body with `schema`, throwing a 422-mapped error on failure. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  throw new RequestValidationError(
    result.error.issues.map((issue) => ({
      type: issue.code,
      loc: ["body", ...issue.path.map((part) => (typeof part === "number" ? part : String(part)))],
      msg: issue.message,
    })),
  );
}

/** Final handler for paths that match an existing route but not its method. */
export function methodNotAllowed(...allowed: string[]): RequestHandler {
  const allow = allowed.join(", ");
  return (_req, res) => {
    res.set("Allow", allow).status(405).json({ detail: "Method Not Allowed" });
  };
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ detail: "Not Found" });
};

function isBodyParseError(error: unknown): boolean {
  return (error as { type?: unknown }).type === "entity.parse.failed";
}

/** Turn thrown errors into JSON responses; anything unexpected is logged and becomes a 500. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ detail: error.detail });
    } else if (error instanceof RequestValidationError) {
      res.status(422).json({ detail: error.issues });
    } else if (isBodyParseError(error)) {
      res.status(422).json({
        detail: [{ type: "json_invalid", loc: ["body"], msg: "JSON decode error" }],
      });
    } else {
      logger.error({ exc_info: error }, "unhandled error");
      res.status(500).json({ detail: "Internal Server Error" });
    }
  };
}
