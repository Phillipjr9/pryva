import { afterEach, describe, expect, it, vi } from "vitest";
import { isArenaPreviewHost, isSameOriginMutation, requestProto } from "@/lib/net";

afterEach(() => vi.unstubAllEnvs());

describe("proxied request origins", () => {
  it("does not mistake a public host with a port for localhost", () => {
    const request = new Request("http://internal:3000/api", { method: "POST", headers: { host: "pryva.example:8443", origin: "https://pryva.example:8443" } });
    expect(requestProto(request)).toBe("https");
    expect(isSameOriginMutation(request)).toBe(true);
  });

  it("corrects the Arena proxy's internal HTTP hop only for this preview sandbox", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("E2B_SANDBOX_ID", "abc123");
    const request = (origin: string, site = "same-origin", host = "3100-abc123.e2b.app") => new Request("http://internal:3100/api", {
      method: "POST", headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "http", origin, "sec-fetch-site": site },
    });
    const valid = request("https://3100-abc123.e2b.app");
    expect(isArenaPreviewHost("3100-abc123.e2b.app")).toBe(true);
    expect(requestProto(valid)).toBe("https");
    expect(isSameOriginMutation(valid)).toBe(true);
    expect(isSameOriginMutation(request("https://evil.e2b.app"))).toBe(false);
    expect(isSameOriginMutation(request("https://3100-abc123.e2b.app", "cross-site"))).toBe(false);
    expect(isSameOriginMutation(request("http://3100-abc123.e2b.app"))).toBe(false);
    expect(isArenaPreviewHost("3100-someoneelse.e2b.app")).toBe(false);
    expect(isArenaPreviewHost("3100-abc123.e2b.app.attacker.test")).toBe(false);
    expect(isArenaPreviewHost("99999-abc123.e2b.app")).toBe(false);
    vi.stubEnv("DATABASE_URL", "postgres://configured/db");
    expect(isArenaPreviewHost("3100-abc123.e2b.app")).toBe(false);
    expect(requestProto(valid)).toBe("http");
    expect(isSameOriginMutation(valid)).toBe(false);
  });

  it("allows local HTTP, honors trusted forwarding and denies sibling origins", () => {
    const local = new Request("http://localhost:3000/api", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } });
    expect(requestProto(local)).toBe("http");
    expect(isSameOriginMutation(local)).toBe(true);
    const proxy = new Request("http://internal:3000/api", { method: "POST", headers: { host: "pryva.example", "x-forwarded-proto": "https", origin: "https://evil.pryva.example" } });
    expect(isSameOriginMutation(proxy)).toBe(false);
    const secureLocal = new Request("https://localhost:3443/api", { headers: { host: "localhost:3443" } });
    expect(requestProto(secureLocal)).toBe("https");
  });
});
