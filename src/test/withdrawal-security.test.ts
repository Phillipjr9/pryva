import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { bankAccounts, users, withdrawals, walletTransactions , paymentTopups } from "@/db/schema";
import { POST } from "@/app/api/wallet/withdraw/route";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), select: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true }),
  createRateLimiter: () => async () => ({ allowed: true }),
}));
const dialect = new PgDialect();

const REQUEST_ID = "da16d859-1301-4851-a124-b9dddf107333";
const OTHER_REQUEST_ID = "47a7c568-8781-416b-8393-57ed13b89d42";

function request(amount: unknown, origin = "https://pryva.test", requestId = REQUEST_ID) {
  return new NextRequest("https://pryva.test/api/wallet/withdraw", {
    method: "POST",
    headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" },
    body: JSON.stringify({ amount, bankAccountId: "f5ca2925-6050-49d2-ab89-fc324953ed11", requestId }),
  });
}

function fakeDatabase() {
  const state = {
    balance: 7000,
    bank: { id: "f5ca2925-6050-49d2-ab89-fc324953ed11", userId: "user-id", bankName: "Test Bank", accountNumber: "1234567890", accountName: "Test User", recipientCode: "RCP-test" },
    withdrawals: [] as Array<Record<string, unknown>>,
    /** Completed card top-ups; the route holds withdrawals against the newest. */
    topups: [] as Array<Record<string, unknown>>,
    ledger: [] as Array<Record<string, unknown>>,
    failLedger: false,
  };
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: (condition: SQL) => ({
        // The hold check orders by paidAt before limiting.
        orderBy: () => ({
          limit: async () => (table === paymentTopups ? state.topups : []),
        }),
        limit: async () => {
          const params = dialect.sqlToQuery(condition).params;
          if (table === withdrawals) return state.withdrawals.filter((row) => row.userId === params[0] && row.requestId === params[1]);
          if (table === bankAccounts) return params[0] === state.bank.id && params[1] === state.bank.userId ? [{ ...state.bank }] : [];
          return [];
        },
      }),
    }),
  }));
  const tx = {
    select: mocks.select,
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: SQL) {
              return {
                async returning() {
                  const params = dialect.sqlToQuery(condition).params;
                  if (table !== users || params[0] !== "user-id" || state.balance < Number(params[1])) return [];
                  state.balance -= Number(dialect.sqlToQuery(values.walletBalance as SQL).params[0]);
                  return [{ balance: state.balance }];
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          if (table === withdrawals) {
            return {
              onConflictDoNothing: () => ({
                async returning() {
                  if (state.withdrawals.some((row) => row.userId === value.userId && row.requestId === value.requestId)) return [];
                  const row = { ...value, id: "withdrawal-id" };
                  state.withdrawals.push(row);
                  return [row];
                },
              }),
            };
          }
          if (table === walletTransactions) {
            if (state.failLedger) return Promise.reject(new Error("ledger unavailable"));
            state.ledger.push(value);
            return Promise.resolve();
          }
          throw new Error("Unexpected table");
        },
      };
    },
  };
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const previous = { balance: state.balance, withdrawals: [...state.withdrawals], ledger: [...state.ledger] };
    try {
      return await callback(tx);
    } catch (error) {
      state.balance = previous.balance;
      state.withdrawals = previous.withdrawals;
      state.ledger = previous.ledger;
      throw error;
    }
  });
  return state;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://test/db"); // database is mocked below
  mocks.currentUser.mockReset().mockResolvedValue({ id: "user-id", email: "user@example.com" });
  mocks.select.mockReset();
  mocks.transaction.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("withdrawal requests", () => {
  it("refuses to withdraw simulated preview funds", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await POST(request(6000))).status).toBe(503);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects anonymous, cross-origin and fractional-naira requests before any write", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    expect((await POST(request(6000))).status).toBe(401);
    expect((await POST(request(6000, "https://attacker.test"))).status).toBe(403);
    expect((await POST(request(6000.5))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before touching balances", async () => {
    const oversized = new NextRequest("https://pryva.test/api/wallet/withdraw", {
      method: "POST", headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ amount: 6000, bankAccountId: "x".repeat(2048) }),
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("only accepts the signed-in user's bank account", async () => {
    const state = fakeDatabase();
    state.bank.userId = "someone-else";
    expect((await POST(request(6000))).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("holds a withdrawal while a card top-up is inside the window", async () => {
    const state = fakeDatabase();
    state.topups = [{ paidAt: new Date(), createdAt: new Date() }];
    const response = await POST(request(6000));
    expect(response.status).toBe(423);
    expect((await response.json()).heldMs).toBeGreaterThan(0);
    // No transfer may be initiated against held funds, not even a pending one.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("releases the hold once the window has passed", async () => {
    const state = fakeDatabase();
    const old = new Date(Date.now() - 49 * 3_600_000);
    state.topups = [{ paidAt: old, createdAt: old }];
    expect((await POST(request(6000))).status).toBe(200);
  });

  it("reserves the balance once and refuses a second withdrawal that would overdraw it", async () => {
    const state = fakeDatabase();
    expect((await POST(request(6000))).status).toBe(200);
    expect((await POST(request(6000, "https://pryva.test", OTHER_REQUEST_ID))).status).toBe(400);
    expect(state.balance).toBe(940);
    expect(state.withdrawals).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ type: "withdrawal", amount: 6060, balanceAfter: 940 });
  });

  it("returns the original receipt for retries and rejects a changed amount", async () => {
    const state = fakeDatabase();
    const first = await (await POST(request(6000))).json();
    const replay = await (await POST(request(6000))).json();
    expect(replay).toMatchObject({ ok: true, replayed: true, withdrawal: { id: first.withdrawal.id, reference: first.withdrawal.reference } });
    expect(replay).not.toHaveProperty("newBalance");
    expect((await POST(request(5000))).status).toBe(409);
    expect(state.balance).toBe(940);
    expect(state.withdrawals).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
  });

  it("rolls back the balance and withdrawal when recording the ledger entry fails", async () => {
    const state = fakeDatabase();
    state.failLedger = true;
    expect((await POST(request(6000))).status).toBe(500);
    expect(state.balance).toBe(7000);
    expect(state.withdrawals).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
  });
});
