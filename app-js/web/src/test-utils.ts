import { vi } from "vitest";

import type { Link } from "./api";

export const LINK: Link = {
  code: "promo",
  short_url: "https://sho.rt/promo",
  target_url: "https://example.com/landing",
  created_at: "2026-10-01T10:00:00.000Z",
  expires_at: null,
  is_expired: false,
  click_count: 1234,
  last_clicked_at: "2026-10-09T08:30:00.000Z",
};

export const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Route = (url: string, init?: RequestInit) => Response | undefined;

/** Stub fetch with a router; unmatched requests fail the test loudly. */
export function mockFetch(route: Route) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = route(url, init);
    if (!res) throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Version endpoint plus whatever else the test routes. */
export function mockApi(route: Route = () => undefined) {
  return mockFetch((url, init) =>
    url === "/version"
      ? json(200, { version: "1.2.3", git_sha: "abcdef0123", environment: "staging" })
      : route(url, init),
  );
}
