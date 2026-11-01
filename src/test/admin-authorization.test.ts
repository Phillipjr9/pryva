import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCurrentUser, isAdminUser, type PublicUser } from "@/lib/auth";
import { db } from "@/db";
import * as analytics from "@/app/api/admin/analytics/route";
import * as auditLog from "@/app/api/admin/audit/route";
import * as exportData from "@/app/api/admin/export/route";
import * as giftCards from "@/app/api/admin/gift-cards/route";
import * as messages from "@/app/api/admin/messages/route";
import * as orders from "@/app/api/admin/orders/route";
import * as refunds from "@/app/api/admin/refunds/route";
import * as metrics from "@/app/api/admin/security/metrics/route";
import * as stats from "@/app/api/admin/stats/route";
import * as suppliers from "@/app/api/admin/suppliers/route";
import * as userDetails from "@/app/api/admin/users/[id]/route";
import * as users from "@/app/api/admin/users/route";
import * as withdrawals from "@/app/api/admin/withdrawals/route";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

const account = (email: string, verified = true): PublicUser => ({
  id: "e6601368-4eef-45e7-a562-f8621c4239f2",
  email,
  name: "Test User",
  walletBalance: 1000,
  emailVerifiedAt: verified ? new Date("2026-01-02T00:00:00Z") : null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const handlers: Array<{ path: string; method: string; handler: Handler }> = [
  { path: "analytics", method: "GET", handler: analytics.GET },
  { path: "audit", method: "GET", handler: auditLog.GET },
  { path: "export", method: "GET", handler: exportData.GET },
  { path: "gift-cards", method: "GET", handler: giftCards.GET },
  { path: "messages", method: "GET", handler: messages.GET },
  { path: "messages", method: "PATCH", handler: messages.PATCH },
  { path: "orders", method: "GET", handler: orders.GET },
  { path: "refunds", method: "GET", handler: refunds.GET },
  { path: "refunds", method: "POST", handler: refunds.POST },
  { path: "security/metrics", method: "GET", handler: metrics.GET },
  { path: "stats", method: "GET", handler: stats.GET },
  { path: "suppliers", method: "GET", handler: suppliers.GET },
  { path: "users", method: "GET", handler: users.GET },
  { path: "users/test-id", method: "GET", handler: userDetails.GET },
  { path: "users/test-id", method: "PUT", handler: userDetails.PUT },
  { path: "withdrawals", method: "GET", handler: withdrawals.GET },
  { path: "withdrawals", method: "PUT", handler: withdrawals.PUT },
];

function request(path: string, method: string, origin = "https://pryva.test") {
  return new NextRequest(`https://pryva.test/api/admin/${path}`, {
    method,
    headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

const context = { params: Promise.resolve({ id: "test-id" }) };

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "Admin@Pryva.test");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("admin authorization", () => {
  it("requires an explicit allowlist hit, and grants nobody when it is empty", () => {
    // Matching is case-insensitive; anything not listed is rejected.
    expect(isAdminUser(account("ADMIN@pryva.test"))).toBe(true);
    expect(isAdminUser(account("customer@example.com"))).toBe(false);
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdminUser(account("admin@pryva.ng"))).toBe(false);
    expect(isAdminUser(account("ADMIN@pryva.test"))).toBe(false);
  });

  it("denies a configured administrator who has not proven control of the address", () => {
    // ADMIN_EMAILS grants privilege by string match, and signup accepted any
    // address with no proof of control. Matching on email alone therefore let a
    // stranger register an administrator's address and inherit that access --
    // refunds, withdrawals, the user list. Verification is what closes it.
    expect(isAdminUser(account("ADMIN@pryva.test", true))).toBe(true);
    expect(isAdminUser(account("ADMIN@pryva.test", false))).toBe(false);
  });

  it.each(handlers)("$method /api/admin/$path rejects anonymous users before database access", async ({ path, method, handler }) => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const select = vi.spyOn(db, "select");
    const update = vi.spyOn(db, "update");
    const transaction = vi.spyOn(db, "transaction");
    const response = await handler(request(path, method), context);
    expect(response.status).toBe(401);
    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(handlers)("$method /api/admin/$path rejects signed-in non-admins before database access", async ({ path, method, handler }) => {
    vi.mocked(getCurrentUser).mockResolvedValue(account("customer@example.com"));
    const select = vi.spyOn(db, "select");
    const update = vi.spyOn(db, "update");
    const transaction = vi.spyOn(db, "transaction");
    const response = await handler(request(path, method), context);
    expect(response.status).toBe(403);
    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a signed-in account that is not on the allowlist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(account("customer@example.com"));
    expect((await users.GET(request("users", "GET"))).status).toBe(403);
  });

  it("allows an explicitly configured admin through to the handler", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(account("admin@pryva.test"));
    expect((await users.GET(request("users", "GET"))).status).toBe(200);
  });

  it("rejects cross-origin admin mutations but allows same-origin validation", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(account("admin@pryva.test"));
    const update = vi.spyOn(db, "update");
    expect((await refunds.POST(request("refunds", "POST", "https://attacker.test"))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect((await refunds.POST(request("refunds", "POST"))).status).toBe(400);
  });
});
