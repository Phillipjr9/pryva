import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  accountSignals,
  bankAccounts,
  fraudEvents,
  giftCards,
  orders,
  paymentTopups,
  referrals,
  users,
  withdrawals,
} from "@/db/schema";

/**
 * Fraud controls.
 *
 * What matters here is not that a score exists but that each reason is true and
 * that none of it can break a money path. So: the hash is one-way and salted, the
 * signals are recorded without the raw address, the assessment reads real rows,
 * the velocity ceilings count from the database, and the referral network check
 * voids a reward rather than paying it.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NETWORK_MATE = "33333333-3333-4333-8333-333333333333";
const REFERRER = "44444444-4444-4444-8444-444444444444";
const REFEREE = "55555555-5555-4555-8555-555555555555";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let fraud: typeof import("@/lib/fraud");
let refLib: typeof import("@/lib/referrals");

const DAY = 24 * 60 * 60 * 1000;

async function seedUser(id: string, email: string, createdAt?: Date) {
  await database.insert(users).values({
    id,
    name: "Ada",
    email,
    passwordHash: "x",
    walletBalance: 0,
    ...(createdAt ? { createdAt } : {}),
  });
}

async function seedBankAccount(userId: string, createdAt?: Date) {
  const [row] = await database
    .insert(bankAccounts)
    .values({
      userId,
      bankName: "GTBank",
      bankCode: "058",
      accountNumber: "0123456789",
      accountName: "ADA OKAFOR",
      ...(createdAt ? { createdAt } : {}),
    })
    .returning({ id: bankAccounts.id });
  return row!.id;
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  fraud = await import("@/lib/fraud");
  refLib = await import("@/lib/referrals");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await database.execute(
    sql`TRUNCATE TABLE fraud_events, account_signals, referrals, referral_codes, withdrawals, bank_accounts, gift_cards, payment_topups, wallet_transactions, orders, users CASCADE`,
  );
});

describe("signup signals", () => {
  it("are one-way, salted and stable", () => {
    const a = fraud.hashSignal("203.0.113.9");
    const b = fraud.hashSignal("203.0.113.9");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    const salted = fraud.hashSignal("203.0.113.9", { FRAUD_HASH_SALT: "another" } as unknown as NodeJS.ProcessEnv);
    expect(salted).not.toBe(a);
  });

  it("refuse to fingerprint what the request does not know", () => {
    expect(fraud.hashSignal(undefined)).toBeNull();
    expect(fraud.hashSignal("")).toBeNull();
    expect(fraud.hashSignal("unknown")).toBeNull();
  });

  it("record the network without the address", async () => {
    await seedUser(USER, "ada@example.com");
    const request = new Request("https://pryva.ng/api/auth/signup", {
      headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 Test" },
    });
    await fraud.recordSignupSignal(request, USER);

    const [row] = await database.select().from(accountSignals).where(eq(accountSignals.userId, USER));
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
  });

  it("are written once, not on every sign-in", async () => {
    await seedUser(USER, "ada@example.com");
    const request = new Request("https://pryva.ng/", { headers: { "x-forwarded-for": "203.0.113.9" } });
    await fraud.recordSignupSignal(request, USER);
    await fraud.recordSignupSignal(new Request("https://pryva.ng/", { headers: { "x-forwarded-for": "198.51.100.7" } }), USER);
    const rows = await database.select().from(accountSignals).where(eq(accountSignals.userId, USER));
    expect(rows).toHaveLength(1);
    expect(rows[0].ipHash).toBe(fraud.hashSignal("203.0.113.9"));
  });

  it("let two accounts be compared", async () => {
    await seedUser(USER, "ada@example.com");
    await seedUser(OTHER, "bola@example.com");
    const shared = fraud.hashSignal("203.0.113.9");
    await database.insert(accountSignals).values([
      { userId: USER, ipHash: shared },
      { userId: OTHER, ipHash: shared },
    ]);
    expect(await fraud.sameNetwork(USER, OTHER)).toBe(true);
    expect(await fraud.sharedNetworkAccounts(USER)).toEqual({ accounts: 2, ipHash: shared });
  });
});

describe("withdrawal assessment", () => {
  it("says nothing about a mature account paying itself again", async () => {
    await seedUser(USER, "ada@example.com", new Date(Date.now() - 60 * DAY));
    const bankAccountId = await seedBankAccount(USER, new Date(Date.now() - 60 * DAY));
    await database.insert(paymentTopups).values({
      reference: "TOP-1",
      userId: USER,
      amount: 100_000,
      status: "paid",
    });
    await database.insert(withdrawals).values({
      userId: USER,
      amount: 20_000,
      bankName: "GTBank",
      accountNumber: "0123456789",
      accountName: "ADA OKAFOR",
      status: "completed",
      reference: "WD-OLD",
      bankAccountId,
    });

    const risk = await fraud.assessWithdrawal({ userId: USER, amount: 10_000, bankAccountId });
    expect(risk).toMatchObject({ level: "low", reasons: [] });
  });

  it("flags a brand-new account paying a brand-new destination", async () => {
    await seedUser(USER, "ada@example.com");
    const bankAccountId = await seedBankAccount(USER);
    const risk = await fraud.assessWithdrawal({ userId: USER, amount: 10_000, bankAccountId });
    expect(risk.level).toBe("high");
    expect(risk.reasons).toContain("account is less than three days old");
    expect(risk.reasons).toContain("payout account was added in the last 24 hours");
    expect(risk.reasons).toContain("this payout account has never been paid before");
  });

  it("flags a withdrawal that is almost everything the account ever deposited", async () => {
    await seedUser(USER, "ada@example.com", new Date(Date.now() - 60 * DAY));
    const bankAccountId = await seedBankAccount(USER, new Date(Date.now() - 60 * DAY));
    await database.insert(paymentTopups).values({ reference: "TOP-2", userId: USER, amount: 50_000, status: "paid" });
    await database.insert(withdrawals).values({
      userId: USER,
      amount: 5_000,
      bankName: "GTBank",
      accountNumber: "0123456789",
      accountName: "ADA OKAFOR",
      status: "completed",
      reference: "WD-OLD-2",
      bankAccountId,
    });

    const risk = await fraud.assessWithdrawal({ userId: USER, amount: 45_000, bankAccountId });
    expect(risk.reasons).toContain("request is almost everything this account has ever deposited");
  });

  it("flags a burst of requests", async () => {
    await seedUser(USER, "ada@example.com", new Date(Date.now() - 60 * DAY));
    const bankAccountId = await seedBankAccount(USER, new Date(Date.now() - 60 * DAY));
    await database.insert(withdrawals).values(
      ["WD-A", "WD-B", "WD-C"].map((reference) => ({
        userId: USER,
        amount: 5_000,
        bankName: "GTBank",
        accountNumber: "0123456789",
        accountName: "ADA OKAFOR",
        status: "pending",
        reference,
        bankAccountId,
      })),
    );

    const risk = await fraud.assessWithdrawal({ userId: USER, amount: 5_000, bankAccountId });
    expect(risk.reasons).toContain("three or more withdrawal requests in 24 hours");
  });

  it("flags a network full of accounts", async () => {
    const shared = fraud.hashSignal("203.0.113.9");
    const ids = [USER, OTHER, NETWORK_MATE, "66666666-6666-4666-8666-666666666666"];
    for (const [index, id] of ids.entries()) {
      await seedUser(id, `user${index}@example.com`, new Date(Date.now() - 60 * DAY));
      await database.insert(accountSignals).values({ userId: id, ipHash: shared });
    }
    const bankAccountId = await seedBankAccount(USER, new Date(Date.now() - 60 * DAY));

    const risk = await fraud.assessWithdrawal({ userId: USER, amount: 5_000, bankAccountId });
    expect(risk.reasons.some((reason) => reason.includes("share this network"))).toBe(true);
  });
});

describe("velocity ceilings", () => {
  it("stop a script at the hourly purchase limit, and allow everything below it", async () => {
    await seedUser(USER, "ada@example.com");
    const seedOrder = (index: number) =>
      database.insert(orders).values({
        reference: `ORD-${index}`,
        userId: USER,
        service: "virtual-numbers",
        productSlug: "netflix-otp",
        productName: "Netflix",
        planLabel: "One code",
        region: "Global",
        duration: "24 hours",
        amount: 1_000,
        status: "active",
        provider: "pryva",
      });

    for (let index = 0; index < 39; index += 1) await seedOrder(index);
    expect(await fraud.purchaseVelocity(USER)).toMatchObject({ allowed: true, count: 39, limit: fraud.PURCHASES_PER_HOUR });

    await seedOrder(39);
    expect(await fraud.purchaseVelocity(USER)).toMatchObject({ allowed: false, count: 40 });
  });

  it("ignore orders older than the hour", async () => {
    await seedUser(USER, "ada@example.com");
    await database.insert(orders).values({
      reference: "ORD-OLD",
      userId: USER,
      service: "virtual-numbers",
      productSlug: "netflix-otp",
      productName: "Netflix",
      planLabel: "One code",
      region: "Global",
      duration: "24 hours",
      amount: 1_000,
      status: "active",
      provider: "pryva",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    expect((await fraud.purchaseVelocity(USER)).count).toBe(0);
  });

  it("stop a day of gift-card redemptions", async () => {
    await seedUser(USER, "ada@example.com");
    await seedUser(OTHER, "buyer@example.com");
    const seedCard = (index: number, redeemedAt: Date | null) =>
      database.insert(giftCards).values({
        code: `PRYVA-AAAA-BBBB-${String(index).padStart(4, "0")}`,
        amount: 1_000,
        initialAmount: 1_000,
        purchasedBy: OTHER,
        redeemedBy: redeemedAt ? USER : null,
        status: redeemedAt ? "redeemed" : "active",
        expiresAt: new Date(Date.now() + 30 * DAY),
        redeemedAt,
      });

    for (let index = 0; index < 9; index += 1) await seedCard(index, new Date(Date.now() - 60_000));
    expect(await fraud.giftCardVelocity(USER)).toMatchObject({ allowed: true, count: 9 });

    await seedCard(9, new Date(Date.now() - 60_000));
    expect(await fraud.giftCardVelocity(USER)).toMatchObject({ allowed: false, count: 10 });

    // Yesterday's redemptions do not count against today's ceiling.
    await seedUser(NETWORK_MATE, "old@example.com");
    await seedCard(10, new Date(Date.now() - 2 * DAY));
    expect((await fraud.giftCardVelocity(USER)).count).toBe(10);
  });
});

describe("the queue", () => {
  it("records what happened, with reasons a person can act on", async () => {
    await seedUser(USER, "ada@example.com");
    await fraud.recordFraudEvent({
      userId: USER,
      kind: "withdrawal_review",
      severity: "high",
      reasons: ["new payout account", "account is less than three days old"],
      amount: 25_000,
      reference: "WD-ABC",
    });

    const [event] = await fraud.listFraudEvents({ openOnly: true });
    expect(event).toMatchObject({ kind: "withdrawal_review", severity: "high", userEmail: "ada@example.com", amount: 25_000 });
    expect(event.reasons).toBe("new payout account; account is less than three days old");
    expect(event.reviewedAt).toBeNull();
  });

  it("empties when reviewed, once", async () => {
    await seedUser(USER, "ada@example.com");
    await seedUser(OTHER, "admin@example.com");
    await fraud.recordFraudEvent({ userId: USER, kind: "purchase_velocity", reasons: ["too many orders"] });
    const [event] = await fraud.listFraudEvents({});

    expect(await fraud.markFraudEventReviewed(event.id, OTHER)).toBe(true);
    expect(await fraud.markFraudEventReviewed(event.id, OTHER)).toBe(false);
    expect(await fraud.listFraudEvents({ openOnly: true })).toHaveLength(0);
    expect(await fraud.listFraudEvents({})).toHaveLength(1);
  });

  it("never fails the caller when the write fails", async () => {
    // A logger call and a swallowed error: the money action must stand.
    const spy = vi.spyOn(database, "insert").mockImplementationOnce(() => {
      throw new Error("database is down");
    });
    await expect(fraud.recordFraudEvent({ userId: USER, kind: "withdrawal_review", reasons: ["x"] })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("referral abuse", () => {
  async function attribute() {
    await seedUser(REFERRER, "inviter@example.com", new Date(Date.now() - 30 * DAY));
    await seedUser(REFEREE, "invited@example.com");
    const code = await refLib.codeForUser(REFERRER);
    await refLib.attributeReferral({ refereeId: REFEREE, code });
    await database.insert(orders).values({
      reference: "ORD-REF",
      userId: REFEREE,
      service: "virtual-numbers",
      productSlug: "netflix-otp",
      productName: "Netflix",
      planLabel: "One code",
      region: "Global",
      duration: "24 hours",
      amount: 10_000,
      status: "active",
      provider: "pryva",
    });
    return code;
  }

  it("pays when the two accounts arrived from different networks", async () => {
    await attribute();
    await database.insert(accountSignals).values([
      { userId: REFERRER, ipHash: fraud.hashSignal("203.0.113.9") },
      { userId: REFEREE, ipHash: fraud.hashSignal("198.51.100.7") },
    ]);

    expect(await refLib.settleReferralRewards()).toMatchObject({ credited: 1, voided: 0 });
    const [row] = await database.select().from(referrals);
    expect(row.status).toBe("credited");
  });

  it("voids a reward between accounts created on one network", async () => {
    await attribute();
    const shared = fraud.hashSignal("203.0.113.9");
    await database.insert(accountSignals).values([
      { userId: REFERRER, ipHash: shared },
      { userId: REFEREE, ipHash: shared },
    ]);

    expect(await refLib.settleReferralRewards()).toMatchObject({ credited: 0, voided: 1 });
    const [row] = await database.select().from(referrals);
    expect(row.status).toBe("void");
    const [inviter] = await database.select({ balance: users.walletBalance }).from(users).where(eq(users.id, REFERRER));
    expect(inviter.balance).toBe(0);
    const events = await database.select().from(fraudEvents).where(eq(fraudEvents.kind, "referral_same_network"));
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("high");
  });

  it("does not punish an account whose signal is missing", async () => {
    await attribute();
    await database.insert(accountSignals).values({ userId: REFERRER, ipHash: fraud.hashSignal("203.0.113.9") });
    expect(await refLib.settleReferralRewards()).toMatchObject({ credited: 1, voided: 0 });
  });
});
