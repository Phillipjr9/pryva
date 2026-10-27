import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

afterEach(() => { vi.unstubAllEnvs(); });

describe("preview and admin headers", () => {
  it("permits framing only for an in-memory e2b preview", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(proxy(new NextRequest("https://3000-test.e2b.app/dashboard")).headers.get("x-frame-options")).toBeNull();
    expect(proxy(new NextRequest("https://pryva.example/dashboard")).headers.get("x-frame-options")).toBe("SAMEORIGIN");
    vi.stubEnv("DATABASE_URL", "postgres://configured");
    expect(proxy(new NextRequest("https://3000-test.e2b.app/dashboard")).headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("never exposes admin API responses via wildcard CORS or public caching", () => {
    const response = proxy(new NextRequest("https://pryva.example/api/admin/users"));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
