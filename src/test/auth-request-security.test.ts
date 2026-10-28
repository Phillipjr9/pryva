import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ check: vi.fn(), clear: vi.fn(), select: vi.fn(), session: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/auth", () => ({
  createSession: mocks.session, hashPassword: () => "hash", verifyPassword: () => true,
  isValidEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email),
  normalizeEmail: (email: string) => email.trim().toLowerCase(), isConfiguredAdminEmail: () => false,
}));
vi.mock("@/lib/auth-rate-limit", () => ({ checkAuthRateLimit: mocks.check, clearAuthRateLimit: mocks.clear }));
vi.mock("@/lib/wallet", () => ({ creditWallet: vi.fn() }));

import * as login from "@/app/api/auth/login/route";
import * as signup from "@/app/api/auth/signup/route";

function request(body: string, overrides: Record<string, string> = {}) {
  return new Request("https://pryva.test/api/auth/login", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json", ...overrides }, body,
  });
}

beforeEach(() => { mocks.check.mockResolvedValue(null); });

describe.each([["login", login.POST], ["signup", signup.POST]] as const)("%s request boundaries", (_name, handler) => {
  it("rejects cross-origin and non-JSON requests", async () => {
    expect((await handler(request('{}', { origin: "https://sibling.pryva.test" }))).status).toBe(403);
    expect((await handler(request('{}', { "content-type": "text/plain" }))).status).toBe(415);
  });
  it("rejects oversized, malformed and non-object JSON bodies", async () => {
    expect((await handler(request('"' + 'x'.repeat(8_192) + '"'))).status).toBe(413);
    expect((await handler(request('{'))).status).toBe(400);
    expect((await handler(request('[]'))).status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("fails closed when shared throttling is unavailable", async () => {
    mocks.check.mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }));
    expect((await handler(request(JSON.stringify({ name: "Person", email: "test@example.com", password: "password123" })))).status).toBe(503);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});

describe("signup field limits", () => {
  it("rejects invalid types and overlong fields before querying accounts", async () => {
    for (const body of [
      { name: "x".repeat(121), email: "test@example.com", password: "password123" },
      { name: "Person", email: "x".repeat(201) + "@example.com", password: "password123" },
      { name: "Person", email: "test@example.com", password: "x".repeat(129) },
      { name: {}, email: "test@example.com", password: "password123" },
    ]) expect((await signup.POST(request(JSON.stringify(body)))).status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
