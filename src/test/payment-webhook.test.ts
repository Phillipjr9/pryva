import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { paymentTopups, users, walletTransactions } from "@/db/schema";
import { POST } from "@/app/api/webhooks/payment/route";
import { logger } from "@/lib/logger";

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

  it("verifies the exact signed UTF-8 body, including a byte order mark", async () => {
    const state = fakeDatabase();
    const body = `\uFEFF${JSON.stringify(payload({ description: "₦ credit ✓" }))}`;
    expect((await POST(request(body))).status).toBe(200);
    expect(state.balance).toBe(3000);
    expect(state.ledger).toHaveLength(1);
  });

  it("rejects oversized payloads before signature or database processing", async () => {
    const body = JSON.stringify({ event: "other", padding: "x".repeat(131_072) });
    expect((await POST(request(body))).status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed and non-NGN or fractional-naira payments", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(JSON.stringify(payload({ currency: "USD" }))))).status).toBe(400);
    expect((await POST(request(JSON.stringify(payload({ amount: 250001 })) ))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("logs what it received when it refuses to credit, which it previously did not", async () => {
    const warn = vi.mocked(logger.warn);
    warn.mockClear();

    const response = await POST(request(JSON.stringify(payload({ currency: "USD" }))));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid payment details" });
    // Paystack does not surface a webhook's response body, so this log line is
    // the only record that a confirmed charge was refused and why.
    expect(warn).toHaveBeenCalledWith(
      "Paystack event rejected: invalid payment details",
      expect.objectContaining({
        reference,
        status: "success",
        currency: "USD",
        metadataType: "wallet_topup",
        metadataUserId: userId,
        amountType: "number",
        amount: 250000,
      }),
    );

    warn.mockClear();
    expect((await POST(request(JSON.stringify(payload({ amount: "250000" }))))).status).toBe(400);
    expect(warn).toHaveBeenCalledWith(
      "Paystack event rejected: invalid payment details",
      expect.objectContaining({ amountType: "string", amount: "250000" }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("credits a fee-bearing charge by matching the net Paystack was asked for", async () => {
    const state = fakeDatabase();
    // The stored top-up is N2,500. With "Pass fees to customers" on, the charge
    // is grossed up to 263960 kobo -- fractional naira, so the whole-naira check
    // and the amount match both rejected it before requested_amount was read.
    const body = JSON.stringify(payload({ amount: 263960, requested_amount: 250000, fees: 13959 }));
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(state.topup.status).toBe("completed");
    expect(state.balance).toBe(3000);
    expect(state.ledger).toHaveLength(1);
    // Credited at the net, never the gross the customer was charged.
    expect(state.ledger[0]).toMatchObject({ userId, reference, amount: 2500, balanceAfter: 3000 });
  });

  it("still refuses a fractional-naira gross when Paystack reports no requested amount", async () => {
    // Failing closed is deliberate: without the net there is no figure to match
    // against, and the verify route can still credit this reference.
    expect((await POST(request(JSON.stringify(payload({ amount: 263960 }))))).status).toBe(400);
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

  it("accepts signed stringified metadata, but rejects malformed or mismatched metadata", async () => {
    const state = fakeDatabase();
    for (const metadata of ["not json", "x".repeat(4097), JSON.stringify({ userId, type: "other" }), JSON.stringify([userId])]) {
      expect((await POST(request(JSON.stringify(payload({ metadata }))))).status).toBe(400);
    }
    const response = await POST(request(JSON.stringify(payload({ metadata: JSON.stringify({ userId, type: "wallet_topup" }) }))));
    expect(response.status).toBe(200);
    expect(state.balance).toBe(3000);
    expect(state.ledger).toHaveLength(1);
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
