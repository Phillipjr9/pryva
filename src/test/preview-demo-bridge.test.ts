import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn(), select: vi.fn(), remove: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@/db", () => ({ db: {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: mocks.select }) }) }) }),
  delete: () => ({ where: mocks.remove }),
} }));
import { destroySession, getCurrentUser } from "@/lib/auth";
import { previewDemoBridgePage } from "@/lib/preview-demo-bridge";

const token = "a".repeat(64);
const user = { id: "demo", name: "Demo", email: "demo@pryva.ng", walletBalance: 100, createdAt: new Date("2026-01-01T00:00:00Z") };
const bridgeHeaders = (host = "3100-abc123.e2b.app", value = token) => new Headers({ host, "x-pryva-preview-session": value });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("E2B_SANDBOX_ID", "abc123");
  mocks.cookies.mockResolvedValue({ get: () => undefined, set: mocks.set });
  mocks.headers.mockResolvedValue(bridgeHeaders());
  mocks.select.mockResolvedValue([{ user }]);
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("Arena public demo session bridge", () => {
  it("authenticates a valid demo session only on this in-memory sandbox", async () => {
    expect(await getCurrentUser()).toMatchObject({ id: "demo", email: "demo@pryva.ng" });
    expect(mocks.select).toHaveBeenCalledOnce();
  });

  it("never accepts the bridge for private accounts, invalid/expired sessions, or malformed tokens", async () => {
    mocks.select.mockResolvedValueOnce([{ user: { ...user, email: "private@example.test" } }]);
    expect(await getCurrentUser()).toBeNull();
    mocks.select.mockResolvedValueOnce([]);
    expect(await getCurrentUser()).toBeNull();
    mocks.headers.mockResolvedValue(bridgeHeaders("3100-abc123.e2b.app", "not-a-session"));
    mocks.select.mockClear();
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects other hosts, other sandboxes, and persistent deployments", async () => {
    for (const host of ["example.test", "3100-other.e2b.app", "3100-abc123.e2b.app.evil.test"]) {
      mocks.headers.mockResolvedValue(bridgeHeaders(host));
      expect(await getCurrentUser()).toBeNull();
    }
    mocks.headers.mockResolvedValue(bridgeHeaders());
    vi.stubEnv("DATABASE_URL", "postgres://configured/db");
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("keeps a valid cookie session ahead of the demo bridge", async () => {
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "cookie-session" } : undefined });
    mocks.select.mockResolvedValueOnce([{ user: { ...user, id: "private", email: "private@example.test" } }]);
    expect(await getCurrentUser()).toMatchObject({ id: "private" });
    expect(mocks.select).toHaveBeenCalledOnce();
  });

  it("revokes a demo bridge token on logout but does not revoke private tokens from the header", async () => {
    await destroySession();
    const dialect = new PgDialect();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(dialect.sqlToQuery(mocks.remove.mock.calls[0][0] as SQL).params).toContain(token);
    mocks.remove.mockClear();
    mocks.select.mockResolvedValueOnce([{ user: { ...user, email: "private@example.test" } }]);
    await destroySession();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("returns a no-store bridge page and safely escapes inline navigation values", async () => {
    const response = previewDemoBridgePage('/dashboard?x=</script><img src=x>', token);
    const html = await response.text();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("worker-src 'self'");
    expect(html).toContain("/preview-demo-bridge.js");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script>");
    expect(response.headers.get("location")).toBeNull();
  });
});
