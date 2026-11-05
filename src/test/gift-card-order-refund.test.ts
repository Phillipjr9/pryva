import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import { orders, users, walletTransactions } from "@/db/schema";

/**
 * A gift card refund is two facts about one event.
 *
 * Buying was already atomic: the order row and the wallet debit commit in one
 * transaction. The way back was not mirrored -- the refund credited the wallet in
 * its own transaction and only then tried to mark the order `refunded`. If that
 * second write failed, the customer had their money back while the order still
 * said `processing`, and the response told support the opposite ("the debit still
 * stands"), which is exactly how an operator ends up refunding a second time.
 *
 * The fake database below rolls a transaction back, so a credit that cannot be
 * recorded has nowhere to hide.
 */

const state = vi.hoisted(() => ({
  balances: { u1: 20_000 } as Record<string, number>,
  orderRows: [] as Array<Record<string, unknown>>,
  ledger: [] as Array<Record<string, unknown>>,
  failOrderWrite: false,
  refundAckLost: false,
  configured: true,
  racedOrder: null as Record<string, unknown> | null,
  orderReads: 0,
  fulfillError: null as Error | null,
  codes: ["GIFT-CODE-1"],
  upstreamId: "fox-1",
}));

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  scheduleWalletEmails: vi.fn(),
}));

class FoxreloadErrorMock extends Error {
  constructor(message: string, public readonly status = 502, public readonly code = "UNKNOWN") {
    super(message);
    this.name = "FoxreloadError";
  }
}

vi.mock("@/lib/providers/foxreload", () => ({
  FoxreloadError: FoxreloadErrorMock,
  isFoxreloadConfigured: () => state.configured,
  resolveFoxreloadProductId: async () => "item-steam-10",
  createFoxreloadOrder: async () => ({ id: state.upstreamId }),
  payFoxreloadOrder: async () => {
    if (state.fulfillError) throw state.fulfillError;
  },
  pollFoxreloadOrderCodes: async () => state.codes,
}));

vi.mock("@/lib/identity/auth", () => ({
  getCurrentUser: async () => ({ id: "u1", email: "buyer@example.com" }),
  requireAuthApi: async () => ({ id: "u1", email: "buyer@example.com" }),
}));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => true }));
vi.mock("@/lib/platform/rate-limit", async (importOriginal) => {
  // Keep the real module: other limiters are constructed when a route imports
  // a money module, and a factory that omits them fails at import time.
  const actual = await importOriginal<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, purchaseRateLimiter: async () => ({ allowed: true, unavailable: false }) };
});
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: mocks.scheduleWalletEmails }));

vi.mock("@/db", () => {
  const dialect = new PgDialect();

  function readRows(fields: Record<string, unknown> | undefined, table: unknown, condition?: SQL) {
    const params = condition ? dialect.sqlToQuery(condition).params : [];
    if (table === users) {
      const balance = state.balances[String(params[0])] ?? 0;
      return fields ? [{ balance }] : [{ id: String(params[0]), walletBalance: balance }];
    }
    if (table === orders) {
      state.orderReads += 1;
      if (state.racedOrder && state.orderReads >= 2) return [state.racedOrder];
      const row = state.orderRows.find((entry) => entry.userId === params[0] && entry.requestId === params[1]);
      return row ? [row] : [];
    }
    throw new Error("Unexpected select source");
  }

  function select(fields?: Record<string, unknown>) {
    let table: unknown;
    const api: Record<string, unknown> = {
      from(source: unknown) {
        table = source;
        return api;
      },
      where(condition: SQL) {
        return {
          limit: () => readRows(fields, table, condition),
        };
      },
    };
    return api;
  }

  function writeOrders(values: Record<string, unknown>, condition: SQL) {
    if (state.failOrderWrite) throw new Error("orders table unavailable");
    const query = dialect.sqlToQuery(condition);
    const [orderId] = query.params;
    const row = state.orderRows.find((entry) => entry.id === orderId);
    if (row && /"refunded_at" is null/i.test(query.sql) && row.refundedAt != null) return [];
    if (row) Object.assign(row, values);
    return [row].filter(Boolean);
  }

  function moveWallet(values: Record<string, unknown>, condition: SQL) {
    const [userId] = dialect.sqlToQuery(condition).params;
    const balance = state.balances[String(userId)];
    if (balance === undefined) return [];
    const expression = dialect.sqlToQuery(values.walletBalance as SQL);
    const amount = Number(expression.params[0]);
    const next = expression.sql.includes(" - ") ? balance - amount : balance + amount;
    state.balances[String(userId)] = next;
    return [{ balance: next }];
  }

  function update(table: unknown) {
    return {
      set(values: Record<string, unknown>) {
        return {
          where(condition: SQL) {
            const result = table === users ? moveWallet(values, condition) : writeOrders(values, condition);
            return {
              returning: async () => result,
              then: (onOk: (value: unknown) => unknown, onErr: (error: unknown) => unknown) =>
                Promise.resolve(result).then(onOk, onErr),
            };
          },
        };
      },
    };
  }

  function insert(table: unknown) {
    return {
      values(value: Record<string, unknown>) {
        if (table === orders) state.orderRows.push({ ...value });
        else if (table === walletTransactions) state.ledger.push({ ...value });
        else throw new Error("Unexpected insert target");
        return Promise.resolve([value]);
      },
    };
  }

  const api = { select, insert, update };
  const tx = { select, insert, update };

  return {
    db: {
      ...api,
      transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
        const snapshot = {
          balances: { ...state.balances },
          orderRows: state.orderRows.map((row) => ({ ...row })),
          ledger: [...state.ledger],
        };
        let committed = false;
        try {
          const result = await callback(tx);
          committed = true;
          if (state.refundAckLost && state.ledger.some((entry) => entry.type === "refund")) {
            state.refundAckLost = false;
            throw new Error("refund commit acknowledgement lost");
          }
          return result;
        } catch (error) {
          if (!committed) {
            state.balances = snapshot.balances;
            state.orderRows = snapshot.orderRows;
            state.ledger = snapshot.ledger;
          }
          throw error;
        }
      },
    },
  };
});

const { POST } = await import("@/app/api/gift-cards/order/route");

function request() {
  return new NextRequest("https://pryva.test/api/gift-cards/order", {
    method: "POST",
    headers: { origin: "https://pryva.test", "content-type": "application/json" },
    body: JSON.stringify({ denominationId: "steam-usd-10", requestId: "11111111-2222-4333-8444-555555555555" }),
  });
}

beforeEach(() => {
  // These tests exercise a mocked live database; no external database is contacted.
  vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
  vi.stubEnv("VERCEL_ENV", "");
  state.balances = { u1: 20_000 };
  state.orderRows = [];
  state.ledger = [];
  state.failOrderWrite = false;
  state.refundAckLost = false;
  state.configured = true;
  state.racedOrder = null;
  state.orderReads = 0;
  state.fulfillError = new Error("provider is down");
  state.codes = ["GIFT-CODE-1"];
  mocks.scheduleWalletEmails.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/gift-cards/order refund", () => {
  it("refuses the legacy mock setting before a debit or supplier call", async () => {
    vi.stubEnv("FOXRELOAD_IS_MOCK", "true");
    expect((await POST(request())).status).toBe(503);
    expect(state.orderRows).toEqual([]);
    expect(state.ledger).toEqual([]);
    expect(state.balances.u1).toBe(20_000);
  });

  it("uses a customer message when gift card ordering is not configured", async () => {
    state.configured = false;
    const response = await POST(request());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain("Gift card purchases are unavailable right now");
    expect(body).not.toMatch(/provider|API|configured/i);
    expect(state.ledger).toEqual([]);
  });

  it("hands the money back and records the refund together", async () => {
    const response = await POST(request());

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.outcome).toBe("refunded");
    expect(body.error).toContain("wallet has been refunded");
    expect(body.error).toContain("before placing another order");
    expect(state.orderRows[0]).toMatchObject({ status: "refunded", providerRequestId: "fox-1" });
    expect(state.ledger.map((entry) => entry.type)).toEqual(["debit", "refund"]);
    expect(state.balances.u1).toBe(20_000);
    // Both wallet entries need their nudge; the route calls the InTx helpers, so
    // nothing else would schedule the receipt email.
    expect(mocks.scheduleWalletEmails).toHaveBeenCalledTimes(2);
  });

  it("keeps the refund out of the wallet when the order cannot be marked refunded", async () => {
    state.failOrderWrite = true;

    const response = await POST(request());

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.outcome).toBe("unconfirmed");
    expect(body.error).toMatch(/couldn't confirm.*refund/i);
    expect(body.error).toContain(body.reference);
    expect(body.error).not.toMatch(/support has been flagged|will refund|has been refunded/i);
    // Nothing was recorded as refunded, so nothing may have been credited back.
    expect(state.orderRows[0].status).toBe("processing");
    expect(state.ledger.map((entry) => entry.type)).toEqual(["debit"]);
    expect(state.balances.u1).toBe(3_500);
  });

  it("keeps raw supplier text out of the response, order notes and logs", async () => {
    const sensitive = "API ERROR secret-and-upstream-response";
    state.fulfillError = new FoxreloadErrorMock(sensitive, 401, "AUTH_ERROR");
    const response = await POST(request());
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).not.toContain(sensitive);
    expect(JSON.stringify(state.orderRows)).not.toContain(sensitive);
    const logs = vi.mocked(console.error).mock.calls;
    expect(JSON.stringify(logs)).not.toContain(sensitive);
    expect(logs).toEqual(expect.arrayContaining([
      expect.arrayContaining([expect.objectContaining({ code: "AUTH_ERROR", status: 401 })]),
    ]));
  });

  it("does not overwrite a refund when the commit acknowledgement is lost", async () => {
    state.refundAckLost = true;
    const response = await POST(request());
    const body = await response.json();
    expect(body.outcome).toBe("unconfirmed");
    expect(body.error).not.toContain("has been refunded");
    expect(state.orderRows[0].status).toBe("refunded");
    expect(state.orderRows[0].refundedAt).toBeInstanceOf(Date);
    expect(state.ledger.map((entry) => entry.type)).toEqual(["debit", "refund"]);
    expect(state.balances.u1).toBe(20_000);
  });

  it.each(["processing", "review", "refunded"])("does not claim a %s replay delivered a gift card", async (status) => {
    state.orderRows.push({ userId: "u1", requestId: "11111111-2222-4333-8444-555555555555", status, reference: "GC-EXISTING", referenceCode: null });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/check your orders and wallet/i);
    expect(body.code).toBeUndefined();
    expect(state.ledger).toEqual([]);
  });

  it("does not claim delivery when an in-flight request wins the idempotency race", async () => {
    state.racedOrder = { status: "processing", reference: "GC-RACE", referenceCode: null };
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/check your orders and wallet/i);
    expect(state.ledger).toEqual([]);
  });

  it("still replays a delivered gift card without another debit", async () => {
    state.racedOrder = { status: "delivered", reference: "GC-RACE", referenceCode: "EXISTING-CODE" };
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, replayed: true, code: "EXISTING-CODE" });
    expect(state.ledger).toEqual([]);
  });

  it("delivers a code without touching the refund path", async () => {
    state.fulfillError = null;

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("GIFT-CODE-1");
    expect(state.orderRows[0]).toMatchObject({ status: "delivered", referenceCode: "GIFT-CODE-1" });
    expect(state.ledger.map((entry) => entry.type)).toEqual(["debit"]);
    expect(state.balances.u1).toBe(3_500);
  });
});
