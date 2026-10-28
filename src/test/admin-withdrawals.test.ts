import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { users, withdrawals, walletTransactions } from "@/db/schema";
import { PUT } from "@/app/api/admin/withdrawals/route";

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), transaction: vi.fn(), initiateTransfer: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction } }));
vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminApi: vi.fn(async () => ({ user: { id: "admin-id", email: "admin@example.com" }, response: null })),
}));
vi.mock("@/lib/paystack", () => ({ initiateTransfer: mocks.initiateTransfer, isPaystackConfigured: () => true }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const dialect = new PgDialect();
const withdrawalId = "9a9963b6-4c1e-4c92-8214-ea901643daba";
const providerReference = "wd-9a9963b64c1e4c928214ea901643daba";
function request(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("https://pryva.test/api/admin/withdrawals", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://pryva.test" },
    body: JSON.stringify({ id: withdrawalId, action, ...extra }),
  });
}

function fakeDatabase() {
  const state = {
    withdrawal: {
      id: withdrawalId, userId: "user-id", amount: 10000, fee: 100,
      recipientCode: "RCP-test", reference: "WD-test", status: "pending",
      paystackReference: null as string | null, transferReference: null as string | null, failureReason: null as string | null,
    },
    balance: 2000,
    ledger: [] as Array<Record<string, unknown>>,
  };

  const update = (table: unknown) => ({
    set(values: Record<string, unknown>) {
      return {
        where(condition: SQL) {
          const query = dialect.sqlToQuery(condition);
          const params = query.params;
          let rows: Array<Record<string, unknown>> = [];
          if (table === withdrawals && params[0] === state.withdrawal.id && (!params[1] || params[1] === state.withdrawal.status) &&
              (!query.sql.includes("is not null") || state.withdrawal.transferReference !== null) &&
              (!query.sql.includes("is null") || state.withdrawal.paystackReference === null)) {
            Object.assign(state.withdrawal, values);
            rows = [{ ...state.withdrawal }];
          } else if (table === users && params[0] === state.withdrawal.userId) {
            state.balance += dialect.sqlToQuery(values.walletBalance as SQL).params[0] as number;
            rows = [{ balance: state.balance }];
          }
          return Object.assign(Promise.resolve(rows), { returning: async () => rows });
        },
      };
    },
  });

  const tx = {
    update,
    insert(table: unknown) {
      return {
        async values(value: Record<string, unknown>) {
          if (table !== walletTransactions) throw new Error("Unexpected table");
          state.ledger.push(value);
        },
      };
    },
  };
  mocks.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => [{ ...state.withdrawal }] }) }),
  }));
  mocks.update.mockImplementation(update);
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const previous = { withdrawal: { ...state.withdrawal }, balance: state.balance, ledger: [...state.ledger] };
    try {
      return await callback(tx);
    } catch (error) {
      state.withdrawal = previous.withdrawal;
      state.balance = previous.balance;
      state.ledger = previous.ledger;
      throw error;
    }
  });
  return state;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://test/db"); // all database operations are mocked
  mocks.select.mockReset();
  mocks.update.mockReset();
  mocks.transaction.mockReset();
  mocks.initiateTransfer.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("admin withdrawal processing", () => {
  it("cannot initiate a Paystack transfer backed by preview balances", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await PUT(request("approve"))).status).toBe(503);
    expect(mocks.initiateTransfer).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("claims a pending withdrawal once before contacting Paystack", async () => {
    const state = fakeDatabase();
    let finishTransfer!: (value: unknown) => void;
    mocks.initiateTransfer.mockReturnValueOnce(new Promise((resolve) => { finishTransfer = resolve; }));

    const first = PUT(request("approve"));
    await vi.waitFor(() => expect(mocks.initiateTransfer).toHaveBeenCalledTimes(1));
    expect(state.withdrawal.paystackReference).toBe(providerReference);
    expect(mocks.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({ reference: providerReference, amount: 1000000, currency: "NGN" }));
    const second = await PUT(request("approve"));
    expect(second.status).toBe(409);
    expect(mocks.initiateTransfer).toHaveBeenCalledTimes(1);

    finishTransfer({ status: true, data: { transfer_code: "TRF-test", reference: providerReference, amount: 1000000, currency: "NGN", status: "pending" } });
    expect((await first).status).toBe(200);
    expect(state.withdrawal.status).toBe("processing");
    expect(state.withdrawal.transferReference).toBe("TRF-test");
  });

  it("keeps a Paystack OTP response in review and does not claim a paid-out transfer", async () => {
    const state = fakeDatabase();
    mocks.initiateTransfer.mockResolvedValueOnce({ status: true, data: { transfer_code: "TRF-test", reference: providerReference, amount: 1000000, currency: "NGN", status: "otp" } });
    const response = await PUT(request("approve"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, needsReview: true, paystackReference: providerReference, message: expect.stringContaining("merchant authorization") });
    expect(state.withdrawal.status).toBe("processing");
    expect(state.withdrawal.paystackReference).toBe(providerReference);
    expect(state.withdrawal.transferReference).toBe("TRF-test");
    expect(state.withdrawal.failureReason).toContain("merchant authorization");
  });

  it("never starts another transfer for a pending row with an existing provider reference", async () => {
    const state = fakeDatabase();
    state.withdrawal.paystackReference = providerReference;
    expect((await PUT(request("approve"))).status).toBe(409);
    expect((await PUT(request("reject"))).status).toBe(409);
    expect(state.balance).toBe(2000);
    expect(mocks.initiateTransfer).not.toHaveBeenCalled();
  });

  it("requires an initiation code and explicit settlement reconciliation before completion", async () => {
    const state = fakeDatabase();
    state.withdrawal.status = "processing";
    expect((await PUT(request("complete"))).status).toBe(400);
    expect((await PUT(request("complete", { reconciliationConfirmed: true, reason: "Verified settlement" }))).status).toBe(409);
    expect(state.withdrawal.status).toBe("processing");
    state.withdrawal.transferReference = "TRF-test";
    expect((await PUT(request("complete", { reconciliationConfirmed: true, reason: "Verified settlement in Paystack" }))).status).toBe(200);
    expect(state.withdrawal.status).toBe("completed");
  });

  it("keeps mismatched provider initiation details for manual review", async () => {
    const state = fakeDatabase();
    mocks.initiateTransfer.mockResolvedValueOnce({ status: true, data: { transfer_code: "TRF-test", reference: "wrong", amount: 1000000, currency: "NGN" } });
    expect((await PUT(request("approve"))).status).toBe(502);
    expect(state.withdrawal.status).toBe("processing");
    expect(state.withdrawal.paystackReference).toBe(providerReference);
    expect(state.withdrawal.transferReference).toBeNull();
    expect(state.balance).toBe(2000);
  });

  it("keeps an unconfirmed transfer for reconciliation instead of immediately refunding", async () => {
    const state = fakeDatabase();
    mocks.initiateTransfer.mockRejectedValueOnce(new Error("network timeout"));
    const response = await PUT(request("approve"));
    expect(response.status).toBe(502);
    expect(state.withdrawal.status).toBe("processing");
    expect(state.withdrawal.failureReason).toContain("unconfirmed");
    expect(state.balance).toBe(2000);
    expect(state.ledger).toHaveLength(0);
  });

  it("rejects and refunds a pending withdrawal at most once", async () => {
    const state = fakeDatabase();
    expect((await PUT(request("reject"))).status).toBe(200);
    expect((await PUT(request("reject"))).status).toBe(409);
    expect(state.withdrawal.status).toBe("rejected");
    expect(state.balance).toBe(12100);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ type: "refund", amount: 10100, balanceAfter: 12100 });
  });
});
