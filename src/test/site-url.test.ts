import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { appLinkOrigin, canonicalSiteUrl } from "@/lib/site-url";

afterEach(() => vi.unstubAllEnvs());

/**
 * A sitemap published every URL on https://pryva.ng while the deployment was
 * served from pryva-two.vercel.app. The domain was never attached, so robots.txt
 * pointed crawlers at a sitemap that did not resolve and every absolute image
 * in every email 404d. These assertions prove a real deployment cannot do that
 * again, and that URL-producing modules no longer hardcode any origin at all.
 */

describe("public origin resolution", () => {
  it("prefers the pinned canonical domain and reduces it to an origin", () => {
    expect(canonicalSiteUrl({
      NEXT_PUBLIC_SITE_URL: "https://shop.pryva.ng/",
      VERCEL_PROJECT_PRODUCTION_URL: "pryva-two.vercel.app",
    })).toBe("https://shop.pryva.ng");
  });

  it("refuses a placeholder copied out of .env.example", () => {
    expect(canonicalSiteUrl({
      NEXT_PUBLIC_SITE_URL: "https://your-domain.com",
      VERCEL_URL: "pryva-two.vercel.app",
    })).toBe("https://pryva-two.vercel.app");
    expect(canonicalSiteUrl({
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      NEXT_PUBLIC_APP_URL: "https://wallet.pryva.ng",
    })).toBe("https://wallet.pryva.ng");
  });

  it("uses Vercel's production alias before a per-deployment URL", () => {
    expect(canonicalSiteUrl({
      VERCEL_PROJECT_PRODUCTION_URL: "pryva-two.vercel.app",
      VERCEL_URL: "pryva-git-main.vercel.app",
    })).toBe("https://pryva-two.vercel.app");
  });

  it("uses the injected deployment host when no custom domain exists", () => {
    expect(canonicalSiteUrl({ VERCEL_URL: "pryva-git-main.vercel.app" }))
      .toBe("https://pryva-git-main.vercel.app");
  });

  it("prefers the wallet override for links a customer clicks in email", () => {
    expect(appLinkOrigin({
      NEXT_PUBLIC_APP_URL: "https://wallet.pryva.ng",
      NEXT_PUBLIC_SITE_URL: "https://pryva.ng",
    })).toBe("https://wallet.pryva.ng");
    expect(canonicalSiteUrl({
      NEXT_PUBLIC_APP_URL: "https://wallet.pryva.ng",
      NEXT_PUBLIC_SITE_URL: "https://pryva.ng",
    })).toBe("https://pryva.ng");
  });

  it("refuses non-http schemes, credentials and unparseable values", () => {
    for (const bad of ["javascript:alert(1)", "https://user:pass@evil.example", "not a url", "ftp://files.example"]) {
      expect(canonicalSiteUrl({
        NEXT_PUBLIC_SITE_URL: bad,
        VERCEL_URL: "live.vercel.app",
      }), bad).toBe("https://live.vercel.app");
    }
  });

  it("falls back only when there is no deployment information at all", () => {
    // A local build or a test. Every real Vercel build injects a host above.
    expect(canonicalSiteUrl({})).toBe("https://pryva.ng");
  });
});

describe("the URLs a deployment actually publishes", () => {
  it("puts the live host in the sitemap and in robots.txt", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pryva-two.vercel.app");

    const urls = sitemap().map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(10);
    expect(urls.every((url) => url.startsWith("https://pryva-two.vercel.app"))).toBe(true);
    expect(urls.some((url) => url.includes("pryva.ng"))).toBe(false);
    expect(robots().sitemap).toBe("https://pryva-two.vercel.app/sitemap.xml");
  });

  it("honours an attached custom domain when one is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryva.ng");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pryva-two.vercel.app");
    expect(sitemap()[0].url).toBe("https://pryva.ng");
    expect(robots().sitemap).toBe("https://pryva.ng/sitemap.xml");
  });

  it("keeps every absolute-URL producer on the shared resolver", () => {
    const files = [
      "src/app/layout.tsx",
      "src/app/robots.ts",
      "src/app/sitemap.ts",
      "src/lib/structured-data.ts",
      "src/lib/email-templates.ts",
      "src/lib/email-change.ts",
      "src/lib/email-verification.ts",
      "src/lib/password-reset.ts",
      "src/lib/wallet-email-outbox.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not hardcode an origin`).not.toMatch(/["'`]https:\/\/pryva\.ng/);
    }
    expect(readFileSync("src/lib/site-url.ts", "utf8")).toContain("VERCEL_PROJECT_PRODUCTION_URL");
  });
});
