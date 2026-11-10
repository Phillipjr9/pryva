import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCloudflareOverview } from "@/lib/admin/cloudflare-analytics";

const ZONE = "a".repeat(32);
const NOW = new Date("2026-01-01T15:30:00Z");
const zoneResult = (body: object) => Response.json({ data: { viewer: { zones: [body] } } });
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("CLOUDFLARE_ANALYTICS_ZONE_ID", ZONE);
  vi.stubEnv("CLOUDFLARE_ANALYTICS_API_TOKEN", "test-private-token");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Cloudflare analytics adapter", () => {
  it("reads two bounded datasets without returning secrets or request queries", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(String(init.body));
      expect(init.headers).toMatchObject({ Authorization: "Bearer test-private-token" });
      expect(init.redirect).toBe("error");
      if (query.includes("firewallEventsAdaptive")) {
        expect(query).toContain("limit: 100");
        expect(query).not.toContain("clientRequestQuery");
        return zoneResult({ firewallEventsAdaptive: [{ datetime: "2026-01-01T15:00:00Z", action: "block", source: "waf", clientCountryName: "US", clientIP: "192.0.2.1", clientRequestPath: "/signup?token=secret" }] });
      }
      expect(query).toContain("2025-12-31T15:00:00.000Z");
      expect(query).toContain("2026-01-01T15:00:00.000Z");
      return zoneResult({ httpRequests1hGroups: [{ dimensions: { datetime: "2026-01-01T14:00:00Z" }, sum: { requests: 25, bytes: 120 } }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await readCloudflareOverview(NOW);
    expect(result).toMatchObject({ configured: true, events: { status: "ready", data: [{ action: "block", path: "/signup" }] }, traffic: { status: "ready", data: [{ requests: 25, bytes: 120 }] } });
    expect(JSON.stringify(result)).not.toContain("test-private-token");
    expect(JSON.stringify(result)).not.toContain("token=secret");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not call Cloudflare from preview or without valid config", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await readCloudflareOverview(NOW)).toMatchObject({ configured: false });
    vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("CLOUDFLARE_ANALYTICS_ZONE_ID", 'bad" }');
    expect(await readCloudflareOverview(NOW)).toMatchObject({ configured: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes partial API errors and malformed responses from empty results", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (String(init.body).includes("firewallEventsAdaptive")) return Response.json({ errors: [{ message: "sensitive details" }] });
      return zoneResult({ httpRequests1hGroups: [] });
    }));
    const result = await readCloudflareOverview(NOW);
    expect(result).toMatchObject({ events: { status: "unavailable" }, traffic: { status: "ready", data: [] } });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    vi.stubGlobal("fetch", vi.fn(async () => zoneResult({ firewallEventsAdaptive: [{ action: "block" }], httpRequests1hGroups: [{ dimensions: { datetime: "bad" }, sum: { requests: -1, bytes: 3 } }] })));
    expect(await readCloudflareOverview(NOW)).toMatchObject({ events: { status: "unavailable" }, traffic: { status: "unavailable" } });
  });
});
