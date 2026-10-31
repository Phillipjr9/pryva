import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { orders, referralCodes, referrals, users, walletTransactions } from "@/db/schema";

/**
 * Referrals: 5% of a friend's first delivered order, capped at ₦2,000, paid once.
 *
 * The rules are tested against a real database because that is where the promise
 * actually lives: `referee_id` is unique, the payout reference is unique, and the
 * claim is a conditional update. A test that mocked those would be testing the
 * mock.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));

const REFERRER = "11111111-1111-4111-8111-111111111111";
const REFEREE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let lib: typeof import("@/lib/referrals");

async function seedUser(id: string, email: string, name = "Ada") {
  await database.insert(users).values({ id, name, email, passwordHash: "x", walletBalance: 0 });
}

async function seedOrder(userId: string, amount: number, status = "active", refunded = false) {
  const reference = `ORD-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  await database.insert(orders).values({
    reference,
    userId,
    service: "virtual-numbers",
    productSlug: "netflix-otp",
    productName: "Netflix",
    planLabel: "One code",
    region: "Global",
    duration: "24 hours",
    amount,
    status,
    provider: "pryva",
    refundedAt: refunded ? new Date() : null,
  });
}

async function balanceOf(userId: string): Promise<number> {
  const [row] = await database.select({ balance: users.walletBalance }).from(users).where(eq(users.id, userId));
  return row?.balance ?? 0;
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  lib = await import("@/lib/referrals");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await database.execute(sql`TRUNCATE TABLE referrals, referral_codes, wallet_transactions, orders, users CASCADE`);
  await seedUser(REFERRER, "ada@example.com");
  await seedUser(REFEREE, "bola@example.com", "Bola");
  await seedUser(OTHER, "chi@example.com", "Chi");
});

describe("the offer", () => {
  it("is 5% of the order, capped at ₦2,000", () => {
    expect(lib.referralRewardFor(10_000, {} as unknown as NodeJS.ProcessEnv)).toBe(500);
    expect(lib.referralRewardFor(100_000, {} as unknown as NodeJS.ProcessEnv)).toBe(2_000);
    expect(lib.referralRewardFor(40_000, {} as unknown as NodeJS.ProcessEnv)).toBe(2_000);
  });

  it("rounds down to whole naira", () => {
    expect(lib.referralRewardFor(1_999, {} as unknown as NodeJS.ProcessEnv)).toBe(99);
  });

  it("moves when the environment moves", () => {
    const env = { REFERRAL_REWARD_PERCENT: "10", REFERRAL_REWARD_CAP_NGN: "5000" } as unknown as NodeJS.ProcessEnv;
    expect(lib.referralRewardFor(20_000, env)).toBe(2_000);
    expect(lib.referralRewardFor(10_000, env)).toBe(1_000);
  });

  it("can be switched off without touching code", () => {
    const env = { REFERRAL_REWARD_PERCENT: "0" } as unknown as NodeJS.ProcessEnv;
    expect(lib.referralRewardFor(10_000, env)).toBe(0);
  });

  it("survives nonsense in the environment", () => {
    const env = { REFERRAL_REWARD_PERCENT: "lots", REFERRAL_REWARD_CAP_NGN: "-5" } as unknown as NodeJS.ProcessEnv;
    expect(lib.referralRewardConfig(env)).toEqual({ percent: 5, capNgn: 2_000 });
  });
});

describe("codes", () => {
  it("forgive case and spaces, and refuse anything else", () => {
    expect(lib.normalizeReferralCode("  abc23def ")).toBe("ABC23DEF");
    expect(lib.normalizeReferralCode("ABC")).toBeNull();
    expect(lib.normalizeReferralCode("ABC10DEF")).toBeNull(); // 0/1 are not in the alphabet
    expect(lib.normalizeReferralCode(12345678)).toBeNull();
  });

  it("are minted once per account and stay the same", async () => {
    const first = await lib.codeForUser(REFERRER);
    const second = await lib.codeForUser(REFERRER);
    expect(first).toMatch(/^[A-Z2-9]{8}$/);
    expect(second).toBe(first);
    const rows = await database.select().from(referralCodes);
    expect(rows).toHaveLength(1);
  });

  it("resolve back to the account that owns them", async () => {
    const code = await lib.codeForUser(OTHER);
    expect(await lib.resolveReferralCode(code!.toLowerCase())).toEqual({ referrerId: OTHER, code });
    expect(await lib.resolveReferralCode("ZZZZZZZZ")).toBeNull();
  });
});

describe("attribution", () => {
  it("records who invited whom", async () => {
    const code = await lib.codeForUser(REFERRER);
    const result = await lib.attributeReferral({ refereeId: REFEREE, code });
    expect(result).toEqual({ ok: true, referrerId: REFERRER, code });
    const rows = await database.select().from(referrals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ referrerId: REFERRER, refereeId: REFEREE, status: "pending" });
  });

  it("ignores a code nobody owns", async () => {
    expect(await lib.attributeReferral({ refereeId: REFEREE, code: "ZZZZZZZZ" })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(await database.select().from(referrals)).toHaveLength(0);
  });

  it("refuses inviting yourself", async () => {
    const code = await lib.codeForUser(REFERRER);
    expect(await lib.attributeReferral({ refereeId: REFERRER, code })).toEqual({ ok: false, reason: "self" });
    expect(await database.select().from(referrals)).toHaveLength(0);
  });

  it("counts once per invited account", async () => {
    const code = await lib.codeForUser(REFERRER);
    const otherCode = await lib.codeForUser(OTHER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    expect(await lib.attributeReferral({ refereeId: REFEREE, code: otherCode })).toEqual({
      ok: false,
      reason: "already-attributed",
    });
    expect(await database.select().from(referrals)).toHaveLength(1);
  });

  it("cannot be written as a self-referral even by hand", async () => {
    await expect(
      database.insert(referrals).values({ referrerId: REFERRER, refereeId: REFERRER, code: "ABC23456" }),
    ).rejects.toBeTruthy();
  });

  it("reads the code from the cookie when the body has none", async () => {
    const code = await lib.codeForUser(REFERRER);
    const request = new Request("https://pryva.ng/api/auth/signup", {
      headers: { cookie: `theme=dark; pryva_ref=${code}` },
    });
    expect(lib.readReferralCodeFrom(request)).toBe(code);
    expect(lib.readReferralCodeFrom(request, "wrong")).toBe(code);
    expect(lib.readReferralCodeFrom(new Request("https://pryva.ng/"))).toBeNull();
  });
});

describe("paying the reward", () => {
  it("credits the inviter once the friend's order is delivered", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedOrder(REFEREE, 10_000);

    const result = await lib.settleReferralRewards({ refereeId: REFEREE });
    expect(result).toMatchObject({ credited: 1, pending: 0, skipped: 0 });

    expect(await balanceOf(REFERRER)).toBe(500);
    const [row] = await database.select().from(referrals);
    expect(row.status).toBe("credited");
    expect(row.rewardAmount).toBe(500);
    expect(row.creditedAt).toBeTruthy();

    const [tx] = await database.select().from(walletTransactions);
    expect(tx).toMatchObject({ userId: REFERRER, amount: 500, type: "credit", reference: row.rewardReference });
    // Customer-facing wording, and it never names a supplier.
    expect(tx.description).toBe("Referral reward — a friend's first order");
  });

  it("pays nothing twice", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedOrder(REFEREE, 10_000);

    await lib.settleReferralRewards();
    const second = await lib.settleReferralRewards();

    expect(second).toMatchObject({ credited: 0 });
    expect(await balanceOf(REFERRER)).toBe(500);
    expect(await database.select().from(walletTransactions)).toHaveLength(1);
  });

  it("waits for an order that is still processing", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedOrder(REFEREE, 25_000, "processing");

    expect(await lib.settleReferralRewards()).toMatchObject({ credited: 0, pending: 1 });
    expect(await balanceOf(REFERRER)).toBe(0);
  });

  it("never pays for a refunded order", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedOrder(REFEREE, 25_000, "refunded", true);

    expect(await lib.settleReferralRewards()).toMatchObject({ credited: 0 });
    expect(await balanceOf(REFERRER)).toBe(0);
  });

  it("applies the cap", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedOrder(REFEREE, 250_000);

    await lib.settleReferralRewards();
    expect(await balanceOf(REFERRER)).toBe(2_000);
  });

  it("pays each inviter their own reward, and only to them", async () => {
    const code = await lib.codeForUser(REFERRER);
    const otherCode = await lib.codeForUser(OTHER);
    await seedUser("44444444-4444-4444-8444-444444444444", "dee@example.com", "Dee");
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await lib.attributeReferral({ refereeId: "44444444-4444-4444-8444-444444444444", code: otherCode });
    await seedOrder(REFEREE, 10_000);
    await seedOrder("44444444-4444-4444-8444-444444444444", 20_000);

    await lib.settleReferralRewards();
    expect(await balanceOf(REFERRER)).toBe(500);
    expect(await balanceOf(OTHER)).toBe(1_000);
  });

  it("settles one referee's invitation without touching the others", async () => {
    const code = await lib.codeForUser(REFERRER);
    await seedUser("44444444-4444-4444-8444-444444444444", "dee@example.com", "Dee");
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await lib.attributeReferral({ refereeId: "44444444-4444-4444-8444-444444444444", code });
    await seedOrder(REFEREE, 10_000);
    await seedOrder("44444444-4444-4444-8444-444444444444", 10_000);

    await lib.settleReferralRewards({ refereeId: REFEREE });
    expect(await balanceOf(REFERRER)).toBe(500);
    const rows = await database.select().from(referrals);
    expect(rows.filter((row) => row.status === "credited")).toHaveLength(1);
  });

  it("uses the friend's first delivered order, not their largest", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedOrder(REFEREE, 4_000);
    await seedOrder(REFEREE, 200_000);

    await lib.settleReferralRewards();
    expect(await balanceOf(REFERRER)).toBe(200);
  });
});

describe("the dashboard view", () => {
  it("masks who joined, and totals only what was actually paid", async () => {
    const code = await lib.codeForUser(REFERRER);
    await lib.attributeReferral({ refereeId: REFEREE, code });
    await seedUser("44444444-4444-4444-8444-444444444444", "dee@example.com", "Dee");
    await lib.attributeReferral({ refereeId: "44444444-4444-4444-8444-444444444444", code });
    await seedOrder(REFEREE, 10_000);
    await lib.settleReferralRewards();

    const overview = await lib.referralOverview(REFERRER);
    expect(overview).toMatchObject({ code, earned: 500, invited: 2, pending: 1, percent: 5, capNgn: 2_000 });
    expect(overview.invites.map((invite) => invite.refereeLabel).sort()).toEqual(["b•••@example.com", "d•••@example.com"]);
  });

  it("shows nothing for an account that has not invited anyone", async () => {
    const overview = await lib.referralOverview(OTHER);
    expect(overview).toMatchObject({ earned: 0, invited: 0, pending: 0, invites: [] });
    expect(overview.code).toMatch(/^[A-Z2-9]{8}$/);
  });
});
