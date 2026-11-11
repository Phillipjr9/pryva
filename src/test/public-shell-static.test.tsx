// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SiteHeaderNav } from "@/components/site/HeaderNav";
import {
  SiteSessionProvider,
  VisitorLink,
  VisitorText,
  parseSiteVisitor,
} from "@/components/site/SiteSession";
import { StickyMobileCta } from "@/components/site/StickyMobileCta";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * The public pages are prerendered and shared between visitors.
 *
 * They were not, once: the header read the session cookie on the server, and
 * because the header sits in the layout of every public page, the whole
 * marketing site rendered per request. A traffic spike on the homepage was a
 * spike of function invocations, and none of it could be served from the edge
 * cache. `next build` reported `ƒ /` where it now reports `○ /`.
 *
 * Two things keep it that way and both are pinned here:
 *
 *   1. nothing in the shared shell reads the request on the server;
 *   2. what does depend on the visitor is resolved in the browser, and the
 *      signed-out markup stays correct when that request fails.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** Every module specifier a file imports from, comments and all ignored. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
}

const SHELL = [
  "src/app/(site)/layout.tsx",
  "src/app/(site)/page.tsx",
  "src/components/site/SiteHeader.tsx",
  "src/components/site/HeaderNav.tsx",
  "src/components/site/SiteFooter.tsx",
  "src/components/site/SiteLink.tsx",
  "src/components/site/SiteSession.tsx",
  "src/components/site/StickyMobileCta.tsx",
  "src/components/site/CookieConsentBanner.tsx",
];

describe("the public shell renders without the request", () => {
  it.each(SHELL)("%s imports nothing that reads cookies, headers or the session", (file) => {
    const imports = importsOf(read(file));
    expect(imports.length).toBeGreaterThan(0);
    // `next/headers` is the only door to `cookies()` and `headers()`, and
    // `@/lib/identity/auth` is the only door to `getCurrentUser()`. Either one in
    // this list turns every page under `(site)` back into a per-request render.
    expect(imports).not.toContain("next/headers");
    expect(imports).not.toContain("@/lib/identity/auth");
    expect(imports).not.toContain("@/db");
  });

  it("does not opt the shell or the homepage out of prerendering", () => {
    for (const file of ["src/app/(site)/layout.tsx", "src/app/(site)/page.tsx"]) {
      expect(read(file)).not.toMatch(/^export const dynamic\b/m);
    }
  });

  it("keeps the homepage and the header synchronous server components", () => {
    // An `async` component here is one `await` away from reading request data.
    expect(read("src/app/(site)/page.tsx")).toMatch(/^export default function HomePage\(\)/m);
    expect(read("src/components/site/SiteHeader.tsx")).toMatch(/^export function SiteHeader\(\)/m);
  });

  it("rebuilds the shared pages on a short expiry rather than freezing them at build time", () => {
    // A literal: Next reads this statically, and `60 * 5` is silently ignored.
    expect(read("src/app/(site)/layout.tsx")).toMatch(/^export const revalidate = 300;$/m);
  });

  it("mounts the session provider around the whole shell", () => {
    const layout = read("src/app/(site)/layout.tsx");
    expect(layout.indexOf("<SiteSessionProvider>")).toBeGreaterThan(-1);
    expect(layout.indexOf("<SiteSessionProvider>")).toBeLessThan(layout.indexOf("<SiteHeader />"));
    expect(layout.indexOf("</SiteSessionProvider>")).toBeGreaterThan(layout.indexOf("<SiteFooter />"));
  });
});

const json = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data });

function Shell() {
  return (
    <SiteSessionProvider>
      <SiteHeaderNav />
      <VisitorLink href="/login?next=%2Fdashboard%2Fdata" signedInHref="/dashboard/data">
        Data Plans
      </VisitorLink>
      <p data-testid="hint">
        <VisitorText signedOut="In your dashboard — sign in to check" signedIn="Open in your dashboard" />
      </p>
      <StickyMobileCta label="Explore the catalogue" targetId="final-cta" href="/signup" signedInHref="/dashboard" />
    </SiteSessionProvider>
  );
}

const hrefOf = (name: string | RegExp) =>
  screen.getAllByRole("link", { name }).map((link) => link.getAttribute("href"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the visitor's session is resolved in the browser", () => {
  it("starts from the signed-out markup the prerendered page carries", () => {
    // Never resolves: this is the page as it is before the answer arrives.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<Shell />);

    expect(hrefOf("Sign in")).toContain("/login");
    expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
    expect(hrefOf("Data Plans")).toEqual(["/login?next=%2Fdashboard%2Fdata"]);
    expect(screen.getByTestId("hint").textContent).toBe("In your dashboard — sign in to check");
    expect(hrefOf("Get started")).toContain("/signup");
  });

  it("asks once, uncached, and switches to the signed-in header and links", async () => {
    const fetchMock = vi.fn(async () => json({ user: { name: "Ada", walletBalance: 12_500 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Shell />);

    expect(await screen.findByRole("link", { name: /Dashboard/ })).toBeTruthy();
    expect(hrefOf(/Dashboard/)).toContain("/dashboard");
    expect(screen.getByText("₦12,500")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(hrefOf("Data Plans")).toEqual(["/dashboard/data"]);
    expect(screen.getByTestId("hint").textContent).toBe("Open in your dashboard");
    // The sticky phone bar follows too.
    expect(hrefOf("Get started")).toEqual(["/dashboard"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/visitor");
    // Not under `/api/auth/`: that prefix carries the edge rate limit meant for
    // sign-in, and a request made by every page view would spend it.
    expect(url.startsWith("/api/auth/")).toBe(false);
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
  });

  it("leaves a signed-out visitor exactly as the page was rendered", async () => {
    const fetchMock = vi.fn(async () => json({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Shell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(hrefOf("Sign in")).toContain("/login");
    expect(hrefOf("Data Plans")).toEqual(["/login?next=%2Fdashboard%2Fdata"]);
    expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
  });

  it.each([
    ["the endpoint is overloaded", () => vi.fn(async () => json({ error: "busy" }, false))],
    ["the network fails", () => vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")))],
    ["the body is not what was promised", () => vi.fn(async () => json({ user: { name: 7 } }))],
  ])("keeps the working signed-out page when %s", async (_case, makeFetch) => {
    const fetchMock = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<Shell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Under a traffic spike this request is the part that may fail. The page
    // must not depend on it: every signed-out link still leads somewhere real.
    expect(hrefOf("Sign in")).toContain("/login");
    expect(hrefOf("Data Plans")).toEqual(["/login?next=%2Fdashboard%2Fdata"]);
    expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
  });

  it("asks again when the page is restored from the back/forward cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ user: { name: "Ada", walletBalance: 500 } }))
      .mockResolvedValueOnce(json({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Shell />);
    expect(await screen.findByRole("link", { name: /Dashboard/ })).toBeTruthy();

    // Signed out in the dashboard, then pressed Back: the restored page still
    // holds the old state until it asks again.
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);

    await waitFor(() => expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("parseSiteVisitor", () => {
  it("accepts only a name and a finite balance", () => {
    expect(parseSiteVisitor({ user: { name: "Ada", walletBalance: 0 } })).toEqual({ name: "Ada", walletBalance: 0 });
    // Extra fields are dropped rather than carried into client state.
    expect(parseSiteVisitor({ user: { name: "Ada", walletBalance: 5, email: "a@b.c" } })).toEqual({
      name: "Ada",
      walletBalance: 5,
    });
  });

  it.each([
    null,
    undefined,
    "signed-in",
    {},
    { user: null },
    { user: "Ada" },
    { user: { name: "Ada" } },
    { user: { walletBalance: 5 } },
    { user: { name: "Ada", walletBalance: "5" } },
    { user: { name: "Ada", walletBalance: Number.NaN } },
  ])("reads %j as signed out", (payload) => {
    expect(parseSiteVisitor(payload)).toBeNull();
  });
});
