import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { orders, users, walletTransactions } from "@/db/schema";
import { POST } from "@/app/api/orders/[id]/refund/route";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), select: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
const dialect = new PgDialect();
const context = { params: Promise.resolve({ id: "order-id" }) };
function request(origin = "https://pryva.test") {
  return new Request("https://pryva.test/api/orders/order-id/refund", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin },
  });
}

function fakeDatabase() {
  const state = {
    order: { id: "order-id", userId: "user-id", status: "active", refundedAt: null as Date | null, amount: 1200,
      provider: "simulated", providerRequestId: null as string | null, service: "numbers", productName: "Test", reference: "ORDER-1",
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

  it("never automatically credits even simulated orders in a persistent database", async () => {
    const state = fakeDatabase();
    vi.stubEnv("DATABASE_URL", "postgres://test/db");
    expect((await POST(request(), context)).status).toBe(503);
    expect(state.balance).toBe(500);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires manual reconciliation for legacy live orders", async () => {
    const state = fakeDatabase();
    state.order.provider = "fleexa";
    state.order.providerRequestId = "request-id";
    expect((await POST(request(), context)).status).toBe(503);
    expect(state.balance).toBe(500);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rolls back the order and wallet if the ledger write fails", async () => {
    const state = fakeDatabase();
    state.failLedger = true;
    expect((await POST(request(), context)).status).toBe(500);
    expect(state.order.status).toBe("active");
    expect(state.order.refundedAt).toBeNull();
    expect(state.balance).toBe(500);
  });
});
