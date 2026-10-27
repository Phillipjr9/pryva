import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { giftCards, users, walletTransactions } from "@/db/schema";
import { createGiftCard, redeemGiftCard } from "@/lib/gift-cards";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
const dialect = new PgDialect();

function fakeDatabase() {
  const state = {
    balances: { buyer: 5000, recipient: 500 } as Record<string, number>,
    cards: [] as Array<Record<string, unknown>>,
    ledger: [] as Array<Record<string, unknown>>,
    failLedger: false,
  };
  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: SQL) {
              return {
                async returning() {
                  const params = dialect.sqlToQuery(condition).params;
                  if (table === users) {
                    const userId = params[0] as string;
                    if (state.balances[userId] === undefined || (params[1] !== undefined && state.balances[userId] < Number(params[1]))) return [];
                    const expression = dialect.sqlToQuery(values.walletBalance as SQL);
                    const amount = Number(expression.params[0]);
                    state.balances[userId] += expression.sql.includes(" - ") ? -amount : amount;
                    return [{ balance: state.balances[userId] }];
                  }
                  if (table === giftCards) {
                    const [code, status, now, userId, minAmount] = params;
                    const card = state.cards.find((row) => row.code === code && row.status === status &&
                      (row.expiresAt as Date).getTime() > new Date(String(now)).getTime() && row.purchasedBy !== userId && Number(row.amount) > Number(minAmount));
                    if (!card) return [];
                    Object.assign(card, values);
                    return [{ ...card }];
                  }
                  throw new Error("Unexpected update");
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
          if (table === giftCards) state.cards.push({ ...value });
          else if (table === walletTransactions) {
            if (state.failLedger) throw new Error("ledger unavailable");
            state.ledger.push({ ...value });
          } else throw new Error("Unexpected insert");
        },
      };
    },
  };
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const previous = { balances: { ...state.balances }, cards: state.cards.map((row) => ({ ...row })), ledger: [...state.ledger] };
    try {
      return await callback(tx);
    } catch (error) {
      state.balances = previous.balances;
      state.cards = previous.cards;
      state.ledger = previous.ledger;
      throw error;
    }
  });
  return state;
}

beforeEach(() => { mocks.transaction.mockReset(); });

describe("gift card transaction safety", () => {
  it("rejects fractional amounts before making a transaction", async () => {
    await expect(createGiftCard({ userId: "buyer", amount: 1000.5 })).rejects.toThrow("whole-naira");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deducts the purchase atomically and refuses a purchase that would overdraw", async () => {
    const state = fakeDatabase();
    await createGiftCard({ userId: "buyer", amount: 4000 });
    await expect(createGiftCard({ userId: "buyer", amount: 4000 })).rejects.toThrow("Insufficient");
    expect(state.balances.buyer).toBe(1000);
    expect(state.cards).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
  });

  it("does not allow self-redemption or a second redemption of the same card", async () => {
    const state = fakeDatabase();
    const card = await createGiftCard({ userId: "buyer", amount: 3000 });
    await expect(redeemGiftCard({ userId: "buyer", code: card.code })).rejects.toThrow();
    expect(await redeemGiftCard({ userId: "recipient", code: card.code })).toEqual({ amount: 3000 });
    await expect(redeemGiftCard({ userId: "recipient", code: card.code })).rejects.toThrow();
    expect(state.balances.recipient).toBe(3500);
    expect(state.ledger).toHaveLength(2);
  });

  it("rolls back card redemption and balance if the ledger write fails", async () => {
    const state = fakeDatabase();
    const card = await createGiftCard({ userId: "buyer", amount: 3000 });
    state.failLedger = true;
    await expect(redeemGiftCard({ userId: "recipient", code: card.code })).rejects.toThrow("ledger unavailable");
    expect(state.cards[0].status).toBe("active");
    expect(state.balances.recipient).toBe(500);
    expect(state.ledger).toHaveLength(1);
  });
});
