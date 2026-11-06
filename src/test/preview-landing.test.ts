import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { previewLandingPath } from "@/lib/platform/preview-landing";

afterEach(() => { vi.unstubAllEnvs(); });

function documentRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers: { "sec-fetch-dest": "document", ...headers } });
}

function enable() {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGHOST", "");
  vi.stubEnv("PREVIEW_LANDING_PATH", "/admin/overview");
}

function locationOf(response: Response): string | null {
  return response.headers.get("location");
}

describe("the preview landing page", () => {
  it("is off unless it is asked for", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PREVIEW_LANDING_PATH", "");
    expect(previewLandingPath()).toBeNull();
    expect(proxy(documentRequest("https://3000-test.e2b.app/")).status).toBe(200);
  });

  it("opens the console on every review, not just the first", () => {
    enable();
    // A preview pane reloads, and a sandbox is reviewed again the next day. A
    // one-time marker would open the shop on the second visit.
    for (let visit = 0; visit < 3; visit += 1) {
      const response = proxy(documentRequest("https://3000-test.e2b.app/"));
      expect(response.status).toBe(307);
      expect(locationOf(response)).toBe("https://3000-test.e2b.app/admin/overview");
    }
  });

  it("emits a Location the proxy adapter can parse without a base", () => {
    enable();
    // Next's proxy adapter re-reads this header with `new NextURL(location)` and
    // no base. A relative "/admin/overview" throws ERR_INVALID_URL there and the
    // preview answers 500 instead of opening the console, so the assertions on
    // the path alone would still pass. Parse it the same way the adapter does.
    const location = locationOf(proxy(documentRequest("https://3000-test.e2b.app/")));
    expect(location).toBeTruthy();
    expect(() => new URL(location as string)).not.toThrow();
    expect(new URL(location as string).pathname).toBe("/admin/overview");
  });

  it("never redirects a deployment with a real database", () => {
    enable();
    vi.stubEnv("DATABASE_URL", "postgres://configured/db");
    expect(previewLandingPath()).toBeNull();
    expect(proxy(documentRequest("https://pryva.example/")).status).toBe(200);
    // Aurora via RDS IAM is a real database too, with no DATABASE_URL set.
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "db.internal");
    vi.stubEnv("PGUSER", "pryva");
    vi.stubEnv("AWS_REGION", "eu-west-1");
    vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::1:role/pryva");
    expect(previewLandingPath()).toBeNull();
  });

  it("only accepts a console path, never an arbitrary or off-site target", () => {
    enable();
    for (const value of ["https://evil.test/admin", "//evil.test", "/dashboard", "/admin-lookalike", "/admin/../../etc"]) {
      vi.stubEnv("PREVIEW_LANDING_PATH", value);
      expect(locationOf(proxy(documentRequest("https://3000-test.e2b.app/"))), value).toBeNull();
    }
    vi.stubEnv("PREVIEW_LANDING_PATH", "/admin");
    expect(locationOf(proxy(documentRequest("https://3000-test.e2b.app/")))).toBe("https://3000-test.e2b.app/admin");
  });

  it("leaves every other path, API and asset alone", () => {
    enable();
    for (const path of ["/pricing", "/admin/overview", "/api/admin/integrity", "/login"]) {
      const response = proxy(documentRequest(`https://3000-test.e2b.app${path}`));
      expect(response.status, path).toBe(200);
    }
    expect(proxy(new NextRequest("https://3000-test.e2b.app/", { method: "POST" })).status).toBe(200);
  });

  it("lets an explicit storefront link through", () => {
    enable();
    const response = proxy(documentRequest("https://3000-test.e2b.app/?storefront=1"));
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBeNull();
  });

  it("lets the console's own storefront link through, but only same-origin", () => {
    enable();
    // The sidebar links to `/`. Under the app's origin-when-cross-origin policy
    // that navigation carries a same-origin Referer from inside the console.
    const fromAdmin = proxy(documentRequest("https://3000-test.e2b.app/", { referer: "https://3000-test.e2b.app/admin/overview" }));
    expect(fromAdmin.status).toBe(200);
    // Another site must not be able to choose which page this deployment opens.
    const offSite = proxy(documentRequest("https://3000-test.e2b.app/", { referer: "https://evil.test/admin/overview" }));
    expect(offSite.status).toBe(307);
    const malformed = proxy(documentRequest("https://3000-test.e2b.app/", { referer: "not a url" }));
    expect(malformed.status).toBe(307);
  });

  it("does not redirect a prefetch or an RSC payload", () => {
    enable();
    // Next 16 strips the RSC/prefetch headers before the proxy sees them, so
    // `sec-fetch-dest: empty` is the case that carries this in a real browser.
    const prefetches: Record<string, string>[] = [{ rsc: "1" }, { "next-router-prefetch": "1" }, { "sec-fetch-dest": "empty" }];
    for (const headers of prefetches) {
      const response = proxy(documentRequest("https://3000-test.e2b.app/", headers));
      expect(response.status).toBe(200);
      expect(locationOf(response)).toBeNull();
    }
  });

  it("lands the preview pane's iframe navigation and keeps the query", () => {
    enable();
    const embedded = proxy(documentRequest("https://3000-test.e2b.app/?days=7", { "sec-fetch-dest": "iframe" }));
    expect(locationOf(embedded)).toBe("https://3000-test.e2b.app/admin/overview?days=7");
    // Framing and the rest of the security headers still apply to the redirect.
    expect(embedded.headers.get("x-frame-options")).toBeNull();
    expect(embedded.headers.get("x-content-type-options")).toBe("nosniff");
    const top = proxy(documentRequest("http://localhost:3000/"));
    expect(top.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
