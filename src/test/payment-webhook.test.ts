import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { paymentTopups, users, walletTransactions } from "@/db/schema";
import { POST } from "@/app/api/webhooks/payment/route";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const secret = "test-paystack-secret";
const userId = "e6601368-4eef-45e7-a562-f8621c4239f2";
const reference = "TOP-test-reference";
const dialect = new PgDialect();

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: "charge.success",
    data: {
      status: "success",
      reference,
      amount: 250000,
      currency: "NGN",
      metadata: { userId, type: "wallet_topup" },
      ...overrides,
    },
  };
}

function request(body: string, signature = createHmac("sha512", secret).update(body).digest("hex")) {
  return new NextRequest("https://pryva.test/api/webhooks/payment", {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signature },
    body,
  });
}

function fakeDatabase() {
  const state = {
    topup: { reference, userId, amount: 2500, status: "pending", paidAt: null as Date | null },
    balance: 500,
    ledger: [] as Array<Record<string, unknown>>,
    failInsert: false,
  };

  const tx = {
    update(table: unknown) {
      return {
        set(updates: Record<string, unknown>) {
          return {
            where(condition: SQL) {
              return {
                async returning() {
                  const params = dialect.sqlToQuery(condition).params;
                  if (table === paymentTopups) {
                    const matches = params[0] === state.topup.reference && params[1] === state.topup.userId &&
                      params[2] === state.topup.amount && params[3] === state.topup.status;
                    if (!matches) return [];
                    state.topup.status = String(updates.status);
                    state.topup.paidAt = updates.paidAt as Date;
                    return [{ ...state.topup }];
                  }
                  if (table === users && params[0] === state.topup.userId) {
                    const increment = dialect.sqlToQuery(updates.walletBalance as SQL).params[0] as number;
                    state.balance += increment;
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
    select() {
      return {
        from() {
          return {
            where(condition: SQL) {
              return {
                async limit() {
                  return dialect.sqlToQuery(condition).params[0] === state.topup.reference ? [{ ...state.topup }] : [];
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
          if (table !== walletTransactions || state.failInsert) throw new Error("ledger unavailable");
          state.ledger.push(value);
        },
      };
    },
  };

  mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const previous = { topup: { ...state.topup }, balance: state.balance, ledger: [...state.ledger] };
    try {
      return await callback(tx);
    } catch (error) {
      state.topup = previous.topup;
      state.balance = previous.balance;
      state.ledger = previous.ledger;
      throw error;
    }
  });
  return state;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/pryva");
  vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
  mocks.transaction.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Paystack webhook", () => {
  it("fails closed when no secret or persistent database is configured", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect((await POST(request(JSON.stringify(payload())))).status).toBe(503);
    vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
    vi.stubEnv("DATABASE_URL", "");
    expect((await POST(request(JSON.stringify(payload())))).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed or forged signature before database access", async () => {
    const body = JSON.stringify(payload());
    const missing = new NextRequest("https://pryva.test/api/webhooks/payment", { method: "POST", body });
    expect((await POST(missing)).status).toBe(401);
    expect((await POST(request(body, "not-a-signature"))).status).toBe(401);
    expect((await POST(request(body, "0".repeat(128)))).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed and non-NGN or fractional-naira payments", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(JSON.stringify(payload({ currency: "USD" }))))).status).toBe(400);
    expect((await POST(request(JSON.stringify(payload({ amount: 250001 })) ))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("ignores signed non-payment events", async () => {
    expect((await POST(request(JSON.stringify({ event: "transfer.success" })))).status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("credits the matching pending payment once and treats a retry as a duplicate", async () => {
    const state = fakeDatabase();
    const body = JSON.stringify(payload());
    const first = await POST(request(body));
    const second = await POST(request(body));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ duplicate: false });
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(state.topup.status).toBe("completed");
    expect(state.balance).toBe(3000);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ userId, reference, amount: 2500, balanceAfter: 3000 });
  });

  it("does not credit a payment when its amount differs from the pending record", async () => {
    const state = fakeDatabase();
    const response = await POST(request(JSON.stringify(payload({ amount: 400000 }))));
    expect(response.status).toBe(400);
    expect(state.balance).toBe(500);
    expect(state.topup.status).toBe("pending");
    expect(state.ledger).toHaveLength(0);
  });

  it("rolls back the status and credit if the ledger write fails", async () => {
    const state = fakeDatabase();
    state.failInsert = true;
    const response = await POST(request(JSON.stringify(payload())));
    expect(response.status).toBe(500);
    expect(state.balance).toBe(500);
    expect(state.topup.status).toBe("pending");
    expect(state.ledger).toHaveLength(0);
  });
});
