import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCurrentUser, type PublicUser } from "@/lib/auth";
import { authorizeAdminRead } from "@/lib/admin-auth";
import { lastFour, redactPayoutCoordinates } from "@/lib/operator-redaction";
import { db } from "@/db";
import { users as userTable, withdrawals } from "@/db/schema";
import * as usersRoute from "@/app/api/admin/users/route";
import * as withdrawalsRoute from "@/app/api/admin/withdrawals/route";
import * as auditRoute from "@/app/api/admin/audit/route";
import * as giftCardsRoute from "@/app/api/admin/gift-cards/route";
import * as exportRoute from "@/app/api/admin/export/route";
import * as userDetailsRoute from "@/app/api/admin/users/[id]/route";
import * as refundsRoute from "@/app/api/admin/refunds/route";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

const TOKEN = "operator-read-token-used-by-the-tests";

const admin = (): PublicUser => ({
  id: "7c1a4f0e-2b64-4a55-9a2f-5f0f3b6c8d11",
  email: "admin@pryva.test",
  name: "Test Admin",
  walletBalance: 1000,
  emailVerifiedAt: new Date("2026-01-02T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

function request(
  path: string,
  method: string,
  options: { bearer?: string | null; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    host: "pryva.test",
    "x-forwarded-proto": "https",
    origin: options.origin ?? "https://pryva.test",
  };
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
  return new NextRequest(`https://pryva.test/api/admin/${path}`, {
    method,
    headers,
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

function readsGuarded() {
  const select = vi.spyOn(db, "select");
  const update = vi.spyOn(db, "update");
  const transaction = vi.spyOn(db, "transaction");
  return { select, update, transaction };
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@pryva.test");
  vi.stubEnv("OPERATOR_READ_TOKEN", TOKEN);
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("operator read token", () => {
  it("opens a read with no session at all", async () => {
    const response = await usersRoute.GET(request("users", "GET", { bearer: TOKEN }));
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("refuses a wrong token before the database is touched", async () => {
    const guards = readsGuarded();
    const response = await usersRoute.GET(request("users", "GET", { bearer: "not-the-token" }));
    expect(response.status).toBe(401);
    expect(guards.select).not.toHaveBeenCalled();
    expect(guards.update).not.toHaveBeenCalled();
  });

  it("refuses every token when no token is configured", async () => {
    // A deployment that never set the variable must not accept an empty bearer,
    // which is how a fail-open secret check usually arrives.
    vi.stubEnv("OPERATOR_READ_TOKEN", "");
    const guards = readsGuarded();
    const response = await withdrawalsRoute.GET(request("withdrawals", "GET", { bearer: "" }));
    expect(response.status).toBe(401);
    const presented = await withdrawalsRoute.GET(
      request("withdrawals", "GET", { bearer: "anything" }),
    );
    expect(presented.status).toBe(401);
    expect(guards.select).not.toHaveBeenCalled();
  });

  it("does not fall back to the session cookie when the bearer is wrong", async () => {
    // Otherwise a stale token in a shared client would quietly be read as whoever
    // happens to be signed in, and the 401 would never reach the operator.
    vi.mocked(getCurrentUser).mockResolvedValue(admin());
    const response = await usersRoute.GET(request("users", "GET", { bearer: "expired-token" }));
    expect(response.status).toBe(401);
  });

  it("will not answer a mutation, whatever the route tries next", async () => {
    const access = await authorizeAdminRead(
      request("refunds", "POST", { bearer: TOKEN }) as unknown as Request,
    );
    expect(access.response?.status).toBe(403);
    expect(access.user).toBeNull();
  });

  it("keeps the credential-bearing surfaces shut to it", async () => {
    // These three return live gift-card codes, bulk customer dumps and order rows
    // carrying OTP and eSIM activation codes. They are still session-only.
    const cases = [
      { label: "gift-cards", call: () => giftCardsRoute.GET(request("gift-cards", "GET", { bearer: TOKEN })) },
      { label: "export", call: () => exportRoute.GET(request("export?type=users", "GET", { bearer: TOKEN })) },
      {
        label: "users/[id]",
        call: () =>
          userDetailsRoute.GET(
            request("users/some-id", "GET", { bearer: TOKEN }) as never,
            { params: Promise.resolve({ id: "some-id" }) },
          ),
      },
    ];
    for (const item of cases) {
      const guards = readsGuarded();
      const response = await item.call();
      expect(response.status, item.label).toBe(401);
      expect(guards.select, item.label).not.toHaveBeenCalled();
    }
  });

  it("strips payout coordinates for a token and keeps them for the operator's own session", async () => {
    const userId = "9aa1f4c2-6d5b-4f3e-8c7a-1b2d3e4f5a6b";
    await db.insert(userTable).values({
      id: userId,
      name: "Payout Tester",
      email: `payout-${Date.now()}@pryva.test`,
      passwordHash: "hash",
      walletBalance: 500_000,
      emailVerifiedAt: new Date(),
    });
    const reference = `WDR-TEST-${Date.now()}`;
    await db.insert(withdrawals).values({
      userId,
      amount: 120_000,
      fee: 0,
      bankName: "Kuda",
      accountNumber: "5270123456",
      accountName: "Payout Tester",
      recipientCode: "rcp_0abcd1234ef5",
      status: "pending",
      reference,
    });

    const asToken = await withdrawalsRoute.GET(request("withdrawals", "GET", { bearer: TOKEN }));
    expect(asToken.status).toBe(200);
    const tokenRow = (await asToken.json()).withdrawals.find((row: { reference: string }) => row.reference === reference);
    expect(tokenRow, "the seeded payout should be readable").toBeTruthy();
    expect(tokenRow.accountNumber).toBe("3456");
    expect(tokenRow.recipientCode).toBeNull();

    vi.mocked(getCurrentUser).mockResolvedValue(admin());
    const asSession = await withdrawalsRoute.GET(request("withdrawals", "GET"));
    expect(asSession.status).toBe(200);
    const sessionRow = (await asSession.json()).withdrawals.find((row: { reference: string }) => row.reference === reference);
    expect(sessionRow.accountNumber).toBe("5270123456");
    expect(sessionRow.recipientCode).toBe("rcp_0abcd1234ef5");
  });

  it("still rejects an anonymous read that carries no bearer", async () => {
    const guards = readsGuarded();
    const response = await auditRoute.GET(request("audit", "GET", { bearer: null }));
    expect(response.status).toBe(401);
    expect(guards.select).not.toHaveBeenCalled();
  });

  it("refunds POST cannot be reached with the read token and no session", async () => {
    const guards = readsGuarded();
    const response = await refundsRoute.POST(request("refunds", "POST", { bearer: TOKEN }));
    expect(response.status).toBe(401);
    expect(guards.update).not.toHaveBeenCalled();
    expect(guards.transaction).not.toHaveBeenCalled();
  });
});

describe("payout redaction helper", () => {
  it("keeps the last four and says nothing about the rest", () => {
    expect(lastFour("5270123456")).toBe("3456");
    expect(lastFour("1234")).toBe("1234");
    expect(lastFour(null)).toBeNull();
    expect(lastFour(undefined)).toBeNull();
    expect(lastFour("")).toBeNull();
  });

  it("leaves a row it has nothing to hide alone except the two fields", () => {
    const row = { id: "1", amount: 10, accountNumber: "5270123456", recipientCode: "rcp_1" };
    expect(redactPayoutCoordinates(row)).toEqual({
      id: "1",
      amount: 10,
      accountNumber: "3456",
      recipientCode: null,
    });
  });
});
