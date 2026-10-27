import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/paystack", () => ({ initiateTransfer: mocks.initiateTransfer }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const dialect = new PgDialect();
function request(action: string) {
  return new NextRequest("https://pryva.test/api/admin/withdrawals", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://pryva.test" },
    body: JSON.stringify({ id: "withdrawal-id", action }),
  });
}

function fakeDatabase() {
  const state = {
    withdrawal: {
      id: "withdrawal-id", userId: "user-id", amount: 10000, fee: 100,
      recipientCode: "RCP-test", reference: "WD-test", status: "pending",
      transferReference: null as string | null, failureReason: null as string | null,
    },
    balance: 2000,
    ledger: [] as Array<Record<string, unknown>>,
  };

  const update = (table: unknown) => ({
    set(values: Record<string, unknown>) {
      return {
        where(condition: SQL) {
          const params = dialect.sqlToQuery(condition).params;
          let rows: Array<Record<string, unknown>> = [];
          if (table === withdrawals && params[0] === state.withdrawal.id && (!params[1] || params[1] === state.withdrawal.status)) {
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
  mocks.select.mockReset();
  mocks.update.mockReset();
  mocks.transaction.mockReset();
  mocks.initiateTransfer.mockReset();
});

describe("admin withdrawal processing", () => {
  it("claims a pending withdrawal once before contacting Paystack", async () => {
    const state = fakeDatabase();
    let finishTransfer!: (value: unknown) => void;
    mocks.initiateTransfer.mockReturnValueOnce(new Promise((resolve) => { finishTransfer = resolve; }));

    const first = PUT(request("approve"));
    await vi.waitFor(() => expect(mocks.initiateTransfer).toHaveBeenCalledTimes(1));
    const second = await PUT(request("approve"));
    expect(second.status).toBe(409);
    expect(mocks.initiateTransfer).toHaveBeenCalledTimes(1);

    finishTransfer({ status: true, data: { transfer_code: "TRF-test" } });
    expect((await first).status).toBe(200);
    expect(state.withdrawal.status).toBe("processing");
    expect(state.withdrawal.transferReference).toBe("TRF-test");
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
