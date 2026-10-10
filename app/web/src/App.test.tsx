import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { json, LINK, mockApi } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const createSection = () => screen.getByRole("region", { name: "Shorten a URL" });
const lookupSection = () => screen.getByRole("region", { name: "Look up a link" });

describe("App", () => {
  it("shows which build is serving the page", async () => {
    mockApi();
    render(<App />);
    expect(await screen.findByText(/v1\.2\.3/)).toBeDefined();
    expect(screen.getByText("abcdef0")).toBeDefined();
    expect(screen.getByText(/staging/)).toBeDefined();
  });
});

describe("creating a link", () => {
  it("shows the short link and lets you open its stats", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi((url, init) => {
      if (url === "/api/links" && init?.method === "POST") return json(201, LINK);
      if (url === "/api/links/promo") return json(200, LINK);
      return undefined;
    });
    render(<App />);
    const form = within(createSection());

    expect(form.getByRole("button", { name: "Shorten" }).hasAttribute("disabled")).toBe(true);
    await user.type(form.getByLabelText("Long URL"), "https://example.com/landing");
    await user.type(form.getByLabelText(/Custom alias/), "promo");
    await user.click(form.getByRole("button", { name: "Shorten" }));

    const result = await form.findByRole("status");
    expect(within(result).getByRole("link", { name: LINK.short_url })).toBeDefined();
    const body = JSON.parse(
      String(fetchMock.mock.calls.find(([u]) => u === "/api/links")?.[1]?.body),
    );
    expect(body).toEqual({ url: "https://example.com/landing", alias: "promo" });
    expect((form.getByLabelText("Long URL") as HTMLInputElement).value).toBe("");

    await user.click(within(result).getByRole("button", { name: "View stats" }));
    expect(await within(lookupSection()).findByText("1,234")).toBeDefined();
  });

  it("sends the expiry in the browser's timezone, as UTC", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi((url) => (url === "/api/links" ? json(201, LINK) : undefined));
    render(<App />);
    const form = within(createSection());

    await user.type(form.getByLabelText("Long URL"), "https://example.com");
    await user.type(form.getByLabelText(/Expires/), "2030-06-01T12:00");
    await user.click(form.getByRole("button", { name: "Shorten" }));
    await form.findByRole("status");

    const body = JSON.parse(
      String(fetchMock.mock.calls.find(([u]) => u === "/api/links")?.[1]?.body),
    );
    expect(body.expires_at).toBe(new Date("2030-06-01T12:00").toISOString());
  });

  it("marks the alias field when the alias is taken", async () => {
    const user = userEvent.setup();
    mockApi((url) =>
      url === "/api/links" ? json(409, { detail: "Alias already in use" }) : undefined,
    );
    render(<App />);
    const form = within(createSection());

    await user.type(form.getByLabelText("Long URL"), "https://example.com");
    await user.type(form.getByLabelText(/Custom alias/), "taken");
    await user.click(form.getByRole("button", { name: "Shorten" }));

    expect((await form.findByRole("alert")).textContent).toMatch(/already taken/);
    const alias = form.getByLabelText(/Custom alias/);
    expect(alias.getAttribute("aria-invalid")).toBe("true");
    expect(form.getByText(/Already in use/)).toBeDefined();
  });

  it("marks fields named in validation errors", async () => {
    const user = userEvent.setup();
    mockApi((url) =>
      url === "/api/links"
        ? json(422, {
            detail: [{ loc: ["body", "url"], msg: "must be an http(s) URL with a host" }],
          })
        : undefined,
    );
    render(<App />);
    const form = within(createSection());

    await user.type(form.getByLabelText("Long URL"), "nope");
    await user.click(form.getByRole("button", { name: "Shorten" }));

    expect(await form.findByText("must be an http(s) URL with a host")).toBeDefined();
    expect(form.getByLabelText("Long URL").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows business-rule errors", async () => {
    const user = userEvent.setup();
    mockApi((url) =>
      url === "/api/links"
        ? json(422, { detail: "url must not point at this shortener" })
        : undefined,
    );
    render(<App />);
    const form = within(createSection());

    await user.type(form.getByLabelText("Long URL"), "https://sho.rt/x");
    await user.click(form.getByRole("button", { name: "Shorten" }));

    expect((await form.findByRole("alert")).textContent).toBe(
      "url must not point at this shortener",
    );
  });
});

describe("looking up a link", () => {
  it("accepts a full short URL and shows the details", async () => {
    const user = userEvent.setup();
    mockApi((url) => (url === "/api/links/promo" ? json(200, LINK) : undefined));
    render(<App />);
    const panel = within(lookupSection());

    await user.type(panel.getByLabelText("Short code or URL"), "https://sho.rt/promo");
    await user.click(panel.getByRole("button", { name: "Look up" }));

    expect(await panel.findByText("1,234")).toBeDefined();
    expect(panel.getByRole("link", { name: LINK.target_url })).toBeDefined();
    expect(panel.getByText("Never")).toBeDefined();
    expect(panel.queryByText("Expired")).toBeNull();
  });

  it("flags expired links", async () => {
    const user = userEvent.setup();
    const expired = { ...LINK, is_expired: true, expires_at: "2026-01-01T00:00:00.000Z" };
    mockApi((url) => (url === "/api/links/promo" ? json(200, expired) : undefined));
    render(<App />);
    const panel = within(lookupSection());

    await user.type(panel.getByLabelText("Short code or URL"), "promo");
    await user.click(panel.getByRole("button", { name: "Look up" }));

    expect(await panel.findByText("Expired")).toBeDefined();
  });

  it("says so when the code does not exist", async () => {
    const user = userEvent.setup();
    mockApi((url) =>
      url === "/api/links/nope" ? json(404, { detail: "Link not found" }) : undefined,
    );
    render(<App />);
    const panel = within(lookupSection());

    await user.type(panel.getByLabelText("Short code or URL"), "nope");
    await user.click(panel.getByRole("button", { name: "Look up" }));

    expect(await panel.findByText(/No link with code “nope”/)).toBeDefined();
  });

  it("deletes after confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi((url, init) => {
      if (url !== "/api/links/promo") return undefined;
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : json(200, LINK);
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    const panel = within(lookupSection());

    await user.type(panel.getByLabelText("Short code or URL"), "promo");
    await user.click(panel.getByRole("button", { name: "Look up" }));
    await user.click(await panel.findByRole("button", { name: "Delete link" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(await panel.findByText(/Deleted “promo”/)).toBeDefined();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("keeps the link when deletion is cancelled", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi((url) => (url === "/api/links/promo" ? json(200, LINK) : undefined));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    const panel = within(lookupSection());

    await user.type(panel.getByLabelText("Short code or URL"), "promo");
    await user.click(panel.getByRole("button", { name: "Look up" }));
    await user.click(await panel.findByRole("button", { name: "Delete link" }));

    expect(panel.getByText("1,234")).toBeDefined();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});
