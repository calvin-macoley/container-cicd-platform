/** Request and response shapes (snake_case on the wire, as in the Python service). */

import { z } from "zod";

import type { LinkRecord } from "./repository.js";
import { ALIAS_PATTERN } from "./services/links.js";

export const MAX_URL_LENGTH = 2048;

function isHttpUrlWithHost(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

const targetUrl = z
  .string()
  .max(MAX_URL_LENGTH, { message: `URL should have at most ${MAX_URL_LENGTH} characters` })
  .refine(isHttpUrlWithHost, { message: "must be an http(s) URL with a host" })
  // Normalised like the Python service stored it (e.g. "https://a.b" -> "https://a.b/").
  .transform((raw) => new URL(raw).href);

export const linkCreateSchema = z.strictObject({
  url: targetUrl,
  alias: z
    .string()
    .regex(ALIAS_PATTERN, { message: "must be 3-32 characters: letters, digits, '_' or '-'" })
    .nullish()
    .transform((alias) => alias ?? null),
  // Must carry a timezone (Z or ±hh:mm); naive timestamps are ambiguous.
  expires_at: z.iso
    .datetime({ offset: true, message: "must be an ISO 8601 datetime with a timezone" })
    .nullish()
    .transform((value) => (value == null ? null : new Date(value))),
});

export type LinkCreate = z.output<typeof linkCreateSchema>;

export interface LinkResponse {
  code: string;
  short_url: string;
  target_url: string;
  created_at: string;
  expires_at: string | null;
  is_expired: boolean;
  click_count: number;
  last_clicked_at: string | null;
}

export function toLinkResponse(record: LinkRecord, publicBase: string, now: Date): LinkResponse {
  return {
    code: record.code,
    short_url: `${publicBase}/${record.code}`,
    target_url: record.targetUrl,
    created_at: record.createdAt.toISOString(),
    expires_at: record.expiresAt?.toISOString() ?? null,
    is_expired: record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime(),
    click_count: record.clickCount,
    last_clicked_at: record.lastClickedAt?.toISOString() ?? null,
  };
}
