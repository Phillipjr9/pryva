import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { orders, users, walletTransactions } from "@/db/schema";
import { POST } from "@/app/api/orders/[id]/refund/route";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), select: vi.fn(), transaction: vi.fn(), cancelUpstream: vi.fn(), flagReconciliation: vi.fn(), refundRateLimit: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
// Must be mocked: the route releases the number upstream after committing the
// refund, and an unmocked call would reach the real provider.
vi.mock("@/lib/fulfillment", () => ({ cancelUpstream: mocks.cancelUpstream }));
vi.mock("@/lib/reconciliation", () => ({ flagReconciliation: mocks.flagReconciliation }));
// The throttle is DB-backed, and the fake database below exposes only select and
// transaction -- without this the limiter correctly reports itself unavailable
// and every refund fails closed at 503.
vi.mock("@/lib/rate-limit", () => ({ refundRateLimiter: mocks.refundRateLimit }));
const dialect = new PgDialect();
const context = { params: Promise.resolve({ id: "order-id" }) };
function request(origin = "https://pryva.test") {
  return new Request("https://pryva.test/api/orders/order-id/refund", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin },
  });
}

function fakeDatabase() {
  mocks.refundRateLimit.mockReset();
  mocks.refundRateLimit.mockResolvedValue({ allowed: true, unavailable: false });
  mocks.cancelUpstream.mockReset();
  mocks.cancelUpstream.mockResolvedValue(true);
  mocks.flagReconciliation.mockReset();
  mocks.flagReconciliation.mockResolvedValue(undefined);
  const state = {
    order: { id: "order-id", userId: "user-id", status: "active", refundedAt: null as Date | null, amount: 1200,
      provider: "fleexa", providerRequestId: null as string | null, service: "numbers", productName: "Test", reference: "ORDER-1",
      duration: "Single verification · 20 min window", otpCode: null as string | null, createdAt: new Date(Date.now() - 21 * 60_000) },
    balance: 500,
    ledger: [] as Array<Record<string, unknown>>,
    failLedger: false,
  };
  mocks.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => [{ ...state.order }] }) }),
  }));
  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: SQL) {
              return {
                async returning() {
                  const params = dialect.sqlToQuery(condition).params;
                  if (table === orders) {
                    if (params[0] !== state.order.id || params[1] !== state.order.userId || params[2] !== state.order.status || state.order.refundedAt) return [];
                    Object.assign(state.order, values);
                    return [{ ...state.order }];
                  }
                  if (table === users && params[0] === state.order.userId) {
                    state.balance += Number(dialect.sqlToQuery(values.walletBalance as SQL).params[0]);
                    return [{ balance: state.balance }];
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        async values(value: Record<string, unknown>) {
          if (table !== walletTransactions) throw new Error("Unexpected table");
          if (state.failLedger) throw new Error("ledger unavailable");
          state.ledger.push(value);
        },
      };
    },
  };
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const previous = { order: { ...state.order }, balance: state.balance, ledger: [...state.ledger] };
    try {
      return await callback(tx);
    } catch (error) {
      state.order = previous.order;
      state.balance = previous.balance;
      state.ledger = previous.ledger;
      throw error;
    }
  });
  return state;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  mocks.currentUser.mockReset().mockResolvedValue({ id: "user-id" });
  mocks.select.mockReset();
  mocks.transaction.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("order refund safety", () => {
  it("rejects cross-origin refund attempts", async () => {
    expect((await POST(request("https://attacker.test"), context)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("credits a simulated order once", async () => {
    const state = fakeDatabase();
    expect((await POST(request(), context)).status).toBe(200);
    expect((await POST(request(), context)).status).toBe(409);
    expect(state.order.status).toBe("refunded");
    expect(state.balance).toBe(1700);
    expect(state.ledger).toHaveLength(1);
  });

  it("does not refund delivered codes, rentals, or an unexpired number", async () => {
    const state = fakeDatabase();
    state.order.otpCode = "123456";
    expect((await POST(request(), context)).status).toBe(409);
    state.order.otpCode = null;
    state.order.duration = "7 day rental";
    expect((await POST(request(), context)).status).toBe(409);
    state.order.duration = "Single verification · 20 min window";
    state.order.createdAt = new Date();
    expect((await POST(request(), context)).status).toBe(409);
    expect(state.balance).toBe(500);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refunds an undelivered order against a persistent database, not only in preview", async () => {
    const state = fakeDatabase();
    vi.stubEnv("DATABASE_URL", "postgres://test/db");
    expect((await POST(request(), context)).status).toBe(200);
    expect(state.balance).toBe(1700);
    expect(state.order.status).toBe("refunded");
    expect(mocks.transaction).toHaveBeenCalled();
  });

  it("refunds a live provider order and releases the number upstream afterwards", async () => {
    const state = fakeDatabase();
    state.order.providerRequestId = "request-id";
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, providerCancelled: true });
    expect(state.balance).toBe(1700);
    // The release happens only after the credit commits: cancelling first could
    // free a number that delivered its code a moment later.
    expect(mocks.cancelUpstream).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "fleexa", providerRequestId: "request-id" }),
    );
    expect(mocks.flagReconciliation).not.toHaveBeenCalled();
  });

  it("still credits the customer when the upstream release fails", async () => {
    const state = fakeDatabase();
    state.order.providerRequestId = "request-id";
    mocks.cancelUpstream.mockRejectedValue(new Error("provider 502"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(request(), context);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, providerCancelled: false });
      expect(state.balance).toBe(1700);
      expect(state.order.status).toBe("refunded");
      // Refunded with the number still live upstream: an owner must be able to
      // find this order and finish it by hand.
      expect(mocks.flagReconciliation).toHaveBeenCalledWith("order-id");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rolls back the order and wallet if the ledger write fails", async () => {
    const state = fakeDatabase();
    state.failLedger = true;
    expect((await POST(request(), context)).status).toBe(500);
    expect(state.order.status).toBe("active");
    expect(state.order.refundedAt).toBeNull();
    expect(state.balance).toBe(500);
  });

  it("throttles a refund before looking the order up", async () => {
    fakeDatabase();
    mocks.refundRateLimit.mockResolvedValue({ allowed: false, unavailable: false });

    const response = await POST(request(), context);

    expect(response.status).toBe(429);
    // The throttle sits ahead of the work it protects, so neither the order
    // lookup nor the wallet transaction may have run.
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when the throttle itself is unavailable", async () => {
    fakeDatabase();
    mocks.refundRateLimit.mockResolvedValue({ allowed: true, unavailable: true });

    const response = await POST(request(), context);

    // A refund credits a wallet, so an unreadable counter must refuse rather
    // than wave the request through.
    expect(response.status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
