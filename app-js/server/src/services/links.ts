/** Link business rules: code generation, validation, lookup and deletion. */

import { randomInt } from "node:crypto";

import { CodeConflictError, type LinkRecord, type LinkRepository } from "../repository.js";

export const GENERATED_CODE_LENGTH = 7;
export const MAX_GENERATE_ATTEMPTS = 5;
export const ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Top-level paths owned by the service; a link code equal to one of these
 * would be unreachable (or would shadow the endpoint), so they are refused.
 *
 * `assets` serves the web UI. `docs`, `redoc` and `openapi.json` belonged to
 * the Python service; they stay reserved so either implementation can serve
 * the same database during a canary or rollback.
 */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  "api",
  "assets",
  "healthz",
  "readyz",
  "version",
  "metrics",
  "docs",
  "redoc",
  "openapi.json",
]);

/** No such link (or, for redirects, the link has expired). */
export class LinkNotFoundError extends Error {
  override name = "LinkNotFoundError";
}

/** The requested custom alias is already in use. */
export class AliasConflictError extends Error {
  override name = "AliasConflictError";
}

/** The request is well-formed but breaks a business rule. */
export class InvalidLinkError extends Error {
  override name = "InvalidLinkError";
}

/** Could not find a free code; indicates the code space is too crowded. */
export class CodeGenerationError extends Error {
  override name = "CodeGenerationError";
}

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < GENERATED_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function isReserved(code: string): boolean {
  return RESERVED_CODES.has(code.toLowerCase());
}

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function validate(
  targetUrl: string,
  alias: string | null,
  expiresAt: Date | null,
  publicBase: string,
  now: Date,
): void {
  if (alias !== null && isReserved(alias)) {
    throw new InvalidLinkError(`alias '${alias}' is reserved`);
  }
  if (host(targetUrl) === host(publicBase)) {
    throw new InvalidLinkError("url must not point at this shortener");
  }
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    throw new InvalidLinkError("expires_at must be in the future");
  }
}

export interface CreateLinkParams {
  targetUrl: string;
  alias: string | null;
  expiresAt: Date | null;
  publicBase: string;
  now: Date;
  generate?: () => string;
}

export async function createLink(
  repo: LinkRepository,
  { targetUrl, alias, expiresAt, publicBase, now, generate = generateCode }: CreateLinkParams,
): Promise<LinkRecord> {
  validate(targetUrl, alias, expiresAt, publicBase, now);

  if (alias !== null) {
    try {
      return await repo.create(alias, targetUrl, expiresAt);
    } catch (error) {
      if (error instanceof CodeConflictError) throw new AliasConflictError(alias);
      throw error;
    }
  }

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const code = generate();
    if (isReserved(code)) continue;
    try {
      return await repo.create(code, targetUrl, expiresAt);
    } catch (error) {
      if (error instanceof CodeConflictError) continue;
      throw error;
    }
  }
  throw new CodeGenerationError(`no free code after ${MAX_GENERATE_ATTEMPTS} attempts`);
}

/** Return the redirect target and count the click; expired links are not found. */
export async function resolveLink(repo: LinkRepository, code: string): Promise<string> {
  const target = await repo.resolveAndCount(code);
  if (target === null) throw new LinkNotFoundError(code);
  return target;
}

/** Return the redirect target without counting a click (HEAD requests). */
export async function peekLink(repo: LinkRepository, code: string): Promise<string> {
  const target = await repo.getActiveTarget(code);
  if (target === null) throw new LinkNotFoundError(code);
  return target;
}

/** Return link details, including expired links (management view). */
export async function getLink(repo: LinkRepository, code: string): Promise<LinkRecord> {
  const record = await repo.get(code);
  if (record === null) throw new LinkNotFoundError(code);
  return record;
}

export async function deleteLink(repo: LinkRepository, code: string): Promise<void> {
  if (!(await repo.delete(code))) throw new LinkNotFoundError(code);
}
