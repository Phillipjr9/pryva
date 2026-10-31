import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";
import {
  FRAMEWORK_BANNERS,
  bannersAreQuiet,
  inspectBanners,
  revealsVersion,
} from "@/lib/server-banner";

/**
 * "Remove X-Powered-By and hide the server version."
 *
 * Two different things leak and only one of them is the app's to fix, so the
 * tests are about the *rule* rather than a single header name: no framework
 * banner, no version token, and an honest report for the header the platform
 * writes after the app has finished (`Server`, on Vercel).
 *
 * The live half of this is `scripts/check-headers.mjs`, which asks a running site
 * the same question; it is exercised by hand against `next start` because a test
 * that boots a production server for one header would cost more than it proves.
 */

const read = (path: string) => readFileSync(path, "utf8");

describe("what a response is allowed to say about the stack", () => {
  it("turns the framework banner off at the source", () => {
    // `poweredByHeader: false` is the only thing that actually prevents Next
    // adding the header; delete-in-middleware alone would not.
    expect(read("next.config.ts")).toMatch(/poweredByHeader:\s*false/);
  });

  it("removes every banner name it knows on the way out", () => {
    const response = proxy(new NextRequest("https://pryva.example/dashboard"));
    for (const banner of [...FRAMEWORK_BANNERS, "server"]) {
      expect(response.headers.get(banner), banner).toBeNull();
    }
    // The headers it is supposed to add are still there — this is not a reset.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("lists the banners the proxy strips, so the two cannot drift", () => {
    const source = read("src/proxy.ts");
    expect(source).toContain('from "@/lib/server-banner"');
    expect(source).toContain("FRAMEWORK_BANNERS");
  });

  it("recognises a version, and does not accuse a bare host name", () => {
    for (const value of ["nginx/1.25.3", "Apache/2.4.58 (Ubuntu)", "PHP/8.3.12", "Next.js 16.4.3", "edge-01"]) {
      expect(revealsVersion(value), value).toBe(true);
    }
    // Names software without a version — still a framework banner, but not a
    // version disclosure, and the two are reported differently on purpose.
    for (const value of ["Vercel", "cloudflare", "Express", ""]) {
      expect(revealsVersion(value), value).toBe(false);
    }
    expect(revealsVersion(null)).toBe(false);
  });

  it("reports a framework banner as a leak the app can fix", () => {
    const { leaks, notices } = inspectBanners({
      "X-Powered-By": "Next.js",
      "x-matched-path": "/dashboard/support",
    });
    expect(leaks.map((leak) => leak.header)).toEqual(["x-powered-by", "x-matched-path"]);
    expect(leaks.every((leak) => leak.fixable)).toBe(true);
    expect(notices).toEqual([]);
  });

  it("reads headers case-insensitively, from Headers or a plain object", () => {
    const headers = new Headers({ "X-Powered-By": "PHP/8.3.12" });
    expect(inspectBanners(headers).leaks[0]).toMatchObject({ header: "x-powered-by", value: "PHP/8.3.12" });
    expect(bannersAreQuiet(new Headers({ "content-type": "text/html" }))).toBe(true);
  });

  it("treats a versioned Server header as a leak, and a plain one as a note", () => {
    const versioned = inspectBanners({ server: "nginx/1.25.3" });
    expect(versioned.leaks).toHaveLength(1);
    expect(versioned.leaks[0]).toMatchObject({ header: "server", fixable: true });
    // The note says *why* the app cannot fix it, rather than silently passing.
    expect(versioned.leaks[0].why).toContain("version");

    const platform = inspectBanners({ server: "Vercel" }, { hostedOnVercel: true });
    expect(platform.leaks).toEqual([]);
    expect(platform.notices[0]).toMatchObject({ header: "server", value: "Vercel", fixable: false });
    expect(bannersAreQuiet({ server: "Vercel" })).toBe(true);
  });

  it("ships a live check wired to the same rule", () => {
    expect(existsSync("scripts/check-headers.mjs")).toBe(true);
    const script = read("scripts/check-headers.mjs");
    expect(script).toContain("inspectBanners");
    expect(script).toContain("process.exitCode = 1");
    // Registered so it can be run after a deploy without reading this file.
    expect(JSON.parse(read("package.json")).scripts["headers:check"]).toContain("check-headers.mjs");
  });
});
