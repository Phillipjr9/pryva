import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalSiteUrl, publicOrigin } from "@/lib/net";

/**
 * Moving the site to its own domain.
 *
 * Three things break quietly when a deployment stops living on `*.vercel.app` and
 * starts answering on a domain it owns, and none of them raise an error:
 *
 *   1. A pinned canonical URL keeps rewriting links to the *old* host, so every
 *      referral link, OAuth callback and passkey origin minted on the new domain
 *      names the old one.
 *   2. The absence of a pin leaves absolute URLs pointing at a hardcoded domain
 *      the project does not own — every sitemap entry and verification email
 *      would send people somewhere that has never served this app.
 *   3. Cookies written host-only do not follow the visitor between `www.` and the
 *      apex, so signing in on one name loses the session on the other.
 *
 * These assertions are about those three, not about the domain's current value.
 */

afterEach(() => vi.unstubAllEnvs());

const request = (host: string, url = `https://${host}/api/auth/login`) =>
  new Request(url, { headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" } });

describe("the canonical site URL", () => {
  it("uses the configured site when there is one", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    expect(canonicalSiteUrl()).toBe("https://example.test");
  });

  it("strips a trailing slash so joining a path cannot double it", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test/");
    expect(canonicalSiteUrl()).toBe("https://example.test");
  });

  it("never falls back to a Vercel deployment hostname", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pryva-prod.vercel.app");
    expect(canonicalSiteUrl()).toBe("https://pryvalogs.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryva-prod.vercel.app");
    expect(canonicalSiteUrl()).toBe("https://pryvalogs.com");
  });

  it("uses a real custom production domain if no explicit origin is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "example.test");
    expect(canonicalSiteUrl()).toBe("https://example.test");
  });

  it("never falls back to a domain the project does not own", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(canonicalSiteUrl()).not.toMatch(/pryva\.ng/);
  });
});

describe("a pinned origin steps aside on the canonical host", () => {
  it("rewrites a deployment host to the canonical one", () => {
    // This is the case the pin exists for: a preview's own URL is not the address
    // anyone should be handed.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    expect(publicOrigin(request("pryva-abc123.vercel.app"))).toBe("https://example.test");
  });

  it("lets the canonical host describe itself", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    expect(publicOrigin(request("example.test"))).toBe("https://example.test");
  });

  it("treats www and the apex as the same site", () => {
    // Signing in on one name and being handed links on the other is not a
    // different site; both must resolve to the same canonical origin.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    expect(publicOrigin(request("www.example.test"))).toBe("https://example.test");

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.example.test");
    expect(publicOrigin(request("example.test"))).toBe("https://www.example.test");
  });

  it("ignores a host that only looks like a suffix", () => {
    // `notexample.test` ends with `example.test`; it is not the same site and
    // must not be handed cookies or links for it.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    expect(publicOrigin(request("notexample.test"))).toBe("https://notexample.test");
    expect(publicOrigin(request("example.test.evil.test"))).toBe("https://example.test.evil.test");
  });

  it("does not return a Vercel address even when no origin is pinned", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pryva-abc123.vercel.app");
    expect(publicOrigin(request("pryva-abc123.vercel.app"))).toBe("https://pryvalogs.com");
  });
});

describe("the session cookie follows the site across www", () => {
  it("scopes to the registrable domain on the canonical host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    const { sessionCookieDomain } = await import("@/lib/auth");
    // Without this, signing in on `www.example.test` and opening `example.test`
    // loses the session: a host-only cookie is not sent to the sibling name.
    expect(sessionCookieDomain("example.test")).toBe("example.test");
    expect(sessionCookieDomain("www.example.test")).toBe("example.test");
    expect(sessionCookieDomain("example.test:443")).toBe("example.test");
  });

  it("stays host-only everywhere else", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    const { sessionCookieDomain } = await import("@/lib/auth");
    // A `Domain=vercel.app` cookie would be offered to every unrelated project on
    // that suffix, so this must stay undefined off the canonical domain.
    expect(sessionCookieDomain("pryva-abc123.vercel.app")).toBeUndefined();
    expect(sessionCookieDomain("evil.test")).toBeUndefined();
    expect(sessionCookieDomain("notexample.test")).toBeUndefined();
    expect(sessionCookieDomain("localhost")).toBeUndefined();
    expect(sessionCookieDomain("127.0.0.1")).toBeUndefined();
    expect(sessionCookieDomain(null)).toBeUndefined();
  });

  it("declines to widen a bare two-label host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://pryva");
    const { sessionCookieDomain } = await import("@/lib/auth");
    expect(sessionCookieDomain("pryva")).toBeUndefined();
  });
});
