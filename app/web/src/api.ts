/**
 * Typed client for the shortener API. Paths are relative, so the same bundle
 * works in every environment (the server serves both UI and API).
 */

export interface Link {
  code: string;
  short_url: string;
  target_url: string;
  created_at: string;
  expires_at: string | null;
  is_expired: boolean;
  click_count: number;
  last_clicked_at: string | null;
}

export interface Version {
  version: string;
  git_sha: string;
  environment: string;
}

export type LinkField = "url" | "alias" | "expires_at";
export type FieldErrors = Partial<Record<LinkField, string>>;

interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
}

/** A non-2xx answer, with the server's message and any per-field problems. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FIELDS: readonly string[] = ["url", "alias", "expires_at"];

function toApiError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (status === 409) {
    return new ApiError(status, "That alias is already taken.", {
      alias: "Already in use; pick another.",
    });
  }
  if (Array.isArray(detail)) {
    const fieldErrors: FieldErrors = {};
    for (const issue of detail as ValidationIssue[]) {
      const field = String(issue.loc[1] ?? "");
      if (FIELDS.includes(field)) fieldErrors[field as LinkField] ??= issue.msg;
    }
    return new ApiError(status, "Please fix the highlighted fields.", fieldErrors);
  }
  if (typeof detail === "string") return new ApiError(status, detail);
  return new ApiError(status, `Request failed (HTTP ${status}).`);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and retry.");
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body);
  return body as T;
}

export interface NewLink {
  url: string;
  alias?: string | undefined;
  expiresAt?: Date | undefined;
}

export function createLink({ url, alias, expiresAt }: NewLink): Promise<Link> {
  const body: Record<string, string> = { url };
  if (alias) body.alias = alias;
  if (expiresAt) body.expires_at = expiresAt.toISOString();
  return call<Link>("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const getLink = (code: string): Promise<Link> =>
  call<Link>(`/api/links/${encodeURIComponent(code)}`);

export async function deleteLink(code: string): Promise<void> {
  await call<undefined>(`/api/links/${encodeURIComponent(code)}`, { method: "DELETE" });
}

export const getVersion = (): Promise<Version> => call<Version>("/version");

/** Accepts a bare code or a full short URL ("https://sho.rt/abc" -> "abc"). */
export function extractCode(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    return url.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return trimmed.replace(/^\/+|\/+$/g, "");
  }
}
