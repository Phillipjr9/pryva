import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { bankAccounts, paymentTopups, payoutNameApprovals, users, withdrawals, walletTransactions , } from "@/db/schema";
import { POST } from "@/app/api/wallet/withdraw/route";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), select: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
// Every level the real logger exposes. A partial mock turns a call to a missing
// method into a TypeError that the route's catch reports as a 500, which reads as
// "the route broke" when it was the test double that was incomplete.
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/paystack", () => ({ isPaystackConfigured: () => true }));
// Payouts leave as part of the request now; the provider is not this file's subject.
vi.mock("@/lib/payouts", () => ({ sendPayout: vi.fn(async () => ({ outcome: "sent", transferCode: "TRF-test", providerStatus: "pending" })) }));
vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true }),
  createRateLimiter: () => async () => ({ allowed: true }),
}));
const dialect = new PgDialect();

const REQUEST_ID = "da16d859-1301-4851-a124-b9dddf107333";
const WITHDRAWAL_ID = "b1a2c3d4-0000-4000-8000-00000000000a";
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
    ledger: [] as Array<Record<string, unknown>>,
    failLedger: false,
    // The name frozen when this wallet was funded. Payouts are only allowed to a
    // bank account whose resolved name matches it.
    topups: [{ userId: "user-id", payerName: "Test User" }] as Array<{ userId: string; payerName: string | null }>,
    // A payout name an administrator reviewed. Empty unless a spec adds one.
    approvals: [] as Array<{ userId: string; approvedName: string }>,
  };
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: (condition: SQL) => {
        const limit = async () => {
          const params = dialect.sqlToQuery(condition).params;
          if (table === withdrawals) return state.withdrawals.filter((row) => row.userId === params[0] && row.requestId === params[1]);
          if (table === bankAccounts) return params[0] === state.bank.id && params[1] === state.bank.userId ? [{ ...state.bank }] : [];
          // depositorNameFor() reads the frozen payer name, oldest deposit first.
          if (table === users) return params[0] === "user-id" ? [{ balance: state.balance }] : [];
          if (table === paymentTopups) return state.topups
            .filter((row) => row.userId === params[0] && row.payerName !== null)
            .map((row) => ({ payerName: row.payerName }));
          // payoutApprovalFor() reads the live approval for this account.
          if (table === payoutNameApprovals) return state.approvals
            .filter((row) => row.userId === params[0])
            .map((row) => ({ approvedName: row.approvedName }));
          return [];
        };
        // The payout-name lookup orders by paid_at; the others do not.
        return { limit, orderBy: () => ({ limit }) };
      },
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
                  if (table === withdrawals) {
                    const index = state.withdrawals.findIndex((row) => row.id === params[0]);
                    if (index === -1) return [];
                    // The route claims the row and names the provider reference
                    // inside the same transaction as the debit.
                    state.withdrawals[index] = { ...state.withdrawals[index], ...values };
                    return [{ ...state.withdrawals[index] }];
                  }
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
                  const row = { ...value, id: WITHDRAWAL_ID };
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

/**
 * Money out needs a reachable owner.
 *
 * Verification was advisory everywhere: a link at signup, a banner until it was
 * clicked, nothing else. Browsing and buying can live with that (the goods are on
 * the order page whether or not mail works), but a payout to an address nobody has
 * proven they control cannot be warned, cannot be recovered, and belongs to an
 * account we cannot reach at all. The gate is deliberately narrow -- it fires only
 * when mail is configured, because a requirement nobody can satisfy is a lockout,
 * and it sits before anything is written, so a refusal costs nothing.
 */
describe("email verification before money leaves", () => {
  function configureMail() {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <hello@pryva.ng>");
  }

  it("refuses an unverified address before any row or debit exists", async () => {
    configureMail();
    const state = fakeDatabase();
    mocks.currentUser.mockResolvedValue({ id: "user-id", email: "user@example.com", emailVerifiedAt: null });

    const response = await POST(request(2_000));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("EMAIL_UNVERIFIED");
    expect(body.error).toContain("Verify your email before withdrawing");
    expect(state.withdrawals).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
    expect(state.balance).toBe(7_000);
  });

  it("lets a verified account withdraw", async () => {
    configureMail();
    fakeDatabase();
    mocks.currentUser.mockResolvedValue({ id: "user-id", email: "user@example.com", emailVerifiedAt: new Date() });

    const response = await POST(request(2_000));
    expect(response.status).toBe(200);
  });

  it("cannot lock anybody out when mail is not configured, because no link could be sent", async () => {
    const state = fakeDatabase();
    mocks.currentUser.mockResolvedValue({ id: "user-id", email: "user@example.com", emailVerifiedAt: null });

    const response = await POST(request(2_000));
    expect(response.status).toBe(200);
    expect(state.withdrawals).toHaveLength(1);
  });
});

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

  /**
   * Money leaves only in the name it arrived in.
   *
   * Ownership of the bank account was already enforced -- the 404 above proves a
   * withdrawal cannot name somebody else's saved account. But that only ties the
   * account to this *session*. The gap it left is a mule payout: the account
   * holder saves a bank account in a different person's name, and withdraws to
   * it. The reference is the name frozen on the first settled deposit, not
   * `users.name`, which the profile endpoint can change afterwards.
   */
  it("refuses to pay a bank account in somebody else's name", async () => {
    const state = fakeDatabase();
    state.bank.accountName = "Bola Adeyemi";

    const response = await POST(request(6000));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("same name");
    // Refused before any write: no row, no debit, no ledger entry.
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(state.balance).toBe(7000);
    expect(state.withdrawals).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
  });

  /**
   * The one case the frozen name cannot answer.
   *
   * "Emeka" at signup against "EMEKA CHUKWUEMEKA OKAFOR" on the bank record is one
   * person, and no string rule can prove it. An administrator can, and this is the
   * only way that decision reaches the payout route: a reviewed name stored
   * beside the deposit, never in place of it.
   */
  it("pays a name an administrator reviewed and approved", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Emeka" }];
    state.bank.accountName = "EMEKA CHUKWUEMEKA OKAFOR";
    state.approvals = [{ userId: "user-id", approvedName: "EMEKA CHUKWUEMEKA OKAFOR" }];

    const response = await POST(request(6000));

    expect(response.status).toBe(200);
    expect(state.balance).toBe(940);
    expect(state.withdrawals).toHaveLength(1);
  });

  it("does not let an approval admit a different person's name", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Emeka" }];
    state.bank.accountName = "BOLA ADEYEMI";
    state.approvals = [{ userId: "user-id", approvedName: "EMEKA CHUKWUEMEKA OKAFOR" }];

    expect((await POST(request(6000))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(state.balance).toBe(7000);
  });

  it("ignores an approval belonging to somebody else", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Emeka" }];
    state.bank.accountName = "EMEKA CHUKWUEMEKA OKAFOR";
    state.approvals = [{ userId: "another-user", approvedName: "EMEKA CHUKWUEMEKA OKAFOR" }];

    expect((await POST(request(6000))).status).toBe(403);
  });

  it("does not treat one shared surname as the same person", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Ada Obi" }];
    state.bank.accountName = "CHINEDU OBI";

    expect((await POST(request(6000))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(state.balance).toBe(7000);
  });

  it("refuses a near-miss spelling rather than guessing at it", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Ada Obi" }];
    state.bank.accountName = "ADA OBINNA";

    expect((await POST(request(6000))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses when no settled deposit recorded a depositor name", async () => {
    const state = fakeDatabase();
    state.topups = [];

    const response = await POST(request(6000));

    // A wallet funded before migration 0012 has no recorded depositor, and an
    // absent name is not a match -- it fails closed rather than paying out on the
    // strength of a name nobody captured.
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("no completed deposit");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(state.balance).toBe(7000);
  });

  it("pays the depositor's own name however the bank formatted it", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Ada Obi" }];
    // Surname-first, capitalised, and carrying a middle name the customer never
    // typed at signup -- the way Nigerian bank records usually arrive.
    state.bank.accountName = "OBI ADA CHUKWUEMEKA";

    expect((await POST(request(6000))).status).toBe(200);
    expect(state.withdrawals).toHaveLength(1);
    expect(state.balance).toBe(940);
  });

  it("ignores a title the bank added, because a title is not a name", async () => {
    const state = fakeDatabase();
    state.topups = [{ userId: "user-id", payerName: "Chief Ada Obi" }];
    state.bank.accountName = "ADA OBI";

    expect((await POST(request(6000))).status).toBe(200);
    expect(state.withdrawals).toHaveLength(1);
  });
});
