import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeWalletEmail } from "@/lib/wallet-email-template";
import { emailVerificationEmail } from "@/lib/email-templates";
import { makeEsimDeliveryEmail } from "@/lib/esim-email-template";
import { makeNumberCodeEmail } from "@/lib/number-email-template";

const mocks = vi.hoisted(() => ({ db: undefined as unknown, schedule: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: mocks.schedule }));

import { dispatchWalletEmails } from "@/lib/wallet-email-outbox";
import { buildSecurityNotice } from "@/lib/security-notice";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { logger } from "@/lib/logger";
import { refundWithdrawal } from "@/lib/withdrawal-refund";
import { emailQueueStatus } from "@/lib/email-delivery-events";

const USER = "72e85c0a-9d4a-4d38-a5d0-2a839e05d250";
const EMAIL = "buyer@example.test";
const SENDER = "Pryva <mail@pryva.test>";
let pg: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let fetchMock: ReturnType<typeof vi.fn>;

async function applyMigrations(target: PGlite, through = "0033") {
  const files = (await readdir("migrations")).filter((file) => /^\d{4}_.*\.sql$/.test(file) && file.slice(0, 4) <= through).sort();
  for (const file of files) await target.exec(await readFile(`migrations/${file}`, "utf8"));
}

beforeAll(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  database = drizzle(pg, { schema });
  mocks.db = database;
}, 60_000);

afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", SENDER);
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_placeholder");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryvalogs.com");
  await pg.exec('TRUNCATE TABLE users CASCADE; TRUNCATE TABLE rate_limit_buckets');
  await database.insert(schema.users).values({ id: USER, name: "Ada", email: EMAIL, passwordHash: "old-hash", walletBalance: 20000 });
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mailBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as {
    to: string[]; subject: string; html: string; text: string;
  });
}

async function addOrder(status: string, productName = "Nigeria eSIM") {
  const reference = `PRY-${randomUUID().replace(/-/g, "").slice(0, 21).toUpperCase()}`;
  const [order] = await database.insert(schema.orders).values({
    userId: USER, reference, service: "esim", productSlug: "esim-ng", productName,
    planLabel: "1 GB", region: "Nigeria", duration: "7 days", amount: 2500,
    status, provider: "bitcall", referenceCode: "SENSITIVE-CREDENTIAL",
  }).returning();
  return order;
}

async function debit(order: typeof schema.orders.$inferSelect) {
  return database.insert(schema.walletTransactions).values({
    userId: USER, orderId: order.id, type: "debit", amount: order.amount,
    balanceAfter: 17500, reference: order.reference, description: "Order payment",
  }).returning();
}

async function jobs(kind: string) {
  return database.select().from(schema.walletEmailOutbox).where(eq(schema.walletEmailOutbox.eventKind, kind));
}

describe("account activity emails", () => {
  it("alerts operators when a reset email response does not confirm provider acceptance", async () => {
    const errors = vi.spyOn(logger, "error");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await requestPasswordReset(EMAIL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith("Password reset email acceptance was not confirmed");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(EMAIL);
    expect(await database.select().from(schema.passwordResetTokens)).toHaveLength(1);
  });

  it("snapshots only the bank name and last four, even when the bank is removed immediately", async () => {
    const [bank] = await database.insert(schema.bankAccounts).values({
      userId: USER, bankCode: "044", bankName: "Access <Bank>", accountNumber: "1234567890",
      accountName: "Ada Owner", recipientCode: "RCP-PRIVATE",
    }).returning();
    const [queued] = await jobs("bank_linked");
    expect(queued).toMatchObject({ bankAccountId: bank.id, bankNameSnapshot: "Access <Bank>", bankLastFour: "7890", recipient: EMAIL, status: "pending" });
    expect(queued.availableAt.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    await database.delete(schema.bankAccounts).where(eq(schema.bankAccounts.id, bank.id));
    await database.update(schema.users).set({ email: "new@example.test" }).where(eq(schema.users.id, USER));
    expect(await jobs("bank_linked")).toHaveLength(1);

    await Promise.all([dispatchWalletEmails(1), dispatchWalletEmails(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = mailBodies()[0];
    expect(body.to).toEqual([EMAIL]);
    expect(body.subject).toContain("bank account was linked");
    expect(body.text).toContain("Ending in 7890");
    expect(body.html).toContain("Access &lt;Bank&gt;");
    expect(body.html).toContain("hero-bank.jpg");
    expect(body.html + body.text).not.toContain("1234567890");
    expect(body.html + body.text).not.toContain("RCP-PRIVATE");
    expect(body.html + body.text).not.toContain("Ada Owner");
    expect((await jobs("bank_linked"))[0].status).toBe("sent");
  });

  it("rolls bank alerts back with the account and does not mail for account deletion", async () => {
    await pg.exec(`BEGIN; INSERT INTO bank_accounts(user_id, bank_name, bank_code, account_number, account_name) VALUES ('${USER}', 'Bank', '044', '1234567890', 'Ada'); ROLLBACK;`);
    expect(await jobs("bank_linked")).toHaveLength(0);
    await database.update(schema.users).set({ passwordHash: "sealed", deletedAt: new Date(), email: "closed@example.test" }).where(eq(schema.users.id, USER));
    expect(await jobs("password_changed")).toHaveLength(0);
  });

  it("retries bank alerts with the same payload and provider idempotency key", async () => {
    await database.insert(schema.bankAccounts).values({ userId: USER, bankCode: "044", bankName: "Bank", accountNumber: "1234567890", accountName: "Ada" });
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await dispatchWalletEmails(1)).toMatchObject({ retry: 1 });
    let [job] = await jobs("bank_linked");
    expect(job.status).toBe("pending");
    expect(job.availableAt.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    await pg.exec("UPDATE wallet_email_outbox SET notification_due_at = now() - interval '1 second' WHERE event_kind = 'bank_linked'");
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["Idempotency-Key"]).toBe((first.headers as Record<string, string>)["Idempotency-Key"]);
    [job] = await jobs("bank_linked");
    expect(job).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("lets only the new worker reclaim an expired new-kind lease", async () => {
    await database.insert(schema.bankAccounts).values({ userId: USER, bankCode: "044", bankName: "Bank", accountNumber: "1234567890", accountName: "Ada" });
    fetchMock.mockImplementationOnce(async () => {
      const [inFlight] = await jobs("bank_linked");
      expect(inFlight.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
      expect(inFlight.notificationLockedUntil!.getTime()).toBeLessThan(Date.now() + 180_000);
      throw new Error("sender timed out");
    });
    expect(await dispatchWalletEmails(1)).toMatchObject({ retry: 1 });
    await pg.exec(`UPDATE wallet_email_outbox SET status = 'sending', locked_until = now() + interval '10 years', notification_locked_until = now() - interval '1 second', first_attempt_at = now(), lock_token = gen_random_uuid() WHERE event_kind = 'bank_linked'`);
    const oldWorker = await pg.query<{ event_kind: string }>("SELECT event_kind FROM wallet_email_outbox WHERE (status = 'pending' AND available_at <= now()) OR (status = 'sending' AND (locked_until IS NULL OR locked_until <= now()))");
    expect(oldWorker.rows).toEqual([]);
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect((await jobs("bank_linked"))[0]).toMatchObject({ status: "sent", notificationLockedUntil: null });
  });

  it("sends a change alert after a reset, and a replayed token cannot send a second one", async () => {
    const token = "a-reset-token-long-enough-to-be-safe";
    await database.insert(schema.passwordResetTokens).values({
      userId: USER, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000),
    });
    await database.insert(schema.sessions).values({ userId: USER, token: "session-1", expiresAt: new Date(Date.now() + 60_000) });
    const attempts = await Promise.all([
      resetPassword(token, "NewPassword123!"),
      resetPassword(token, "AnotherPassword123!"),
    ]);
    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.ok)).toHaveLength(1);
    expect(await database.select().from(schema.sessions)).toHaveLength(0);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(await jobs("password_changed")).toHaveLength(1);
    await dispatchWalletEmails(1);
    const body = mailBodies()[0];
    expect(body.to).toEqual([EMAIL]);
    expect(body.subject).toContain("password was changed");
    expect(body.text).toContain("Every other session was signed out");
    expect(body.html).toContain("hero-password.jpg");
    expect(body.html + body.text).not.toContain("NewPassword123!");
  });

  it("queues the first purchase only after a paid order is accepted, once per account", async () => {
    const declined = await addOrder("processing");
    await debit(declined);
    expect(await jobs("first_purchase")).toHaveLength(0);
    await database.update(schema.orders).set({ status: "refunded", refundedAt: new Date() }).where(eq(schema.orders.id, declined.id));
    expect(await jobs("first_purchase")).toHaveLength(0);

    const bought = await addOrder("processing", "<script>eSIM</script>");
    await debit(bought);
    expect(await jobs("first_purchase")).toHaveLength(0);
    await database.update(schema.orders).set({ status: "active" }).where(eq(schema.orders.id, bought.id));
    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, bought.id));
    const later = await addOrder("active");
    await debit(later);
    expect(await jobs("first_purchase")).toHaveLength(1);
    expect(await database.select().from(schema.firstPurchaseEmailClaims)).toMatchObject([{ userId: USER, source: "new" }]);
    await dispatchWalletEmails(8);
    const body = mailBodies().find((mail) => /first purchase/i.test(mail.subject));
    expect(body).toBeDefined();
    expect(body!.text).toContain("₦2,500");
    expect(body!.html).toContain("hero-order.jpg");
    expect(body!.html).toContain("&lt;script&gt;eSIM&lt;/script&gt;");
    expect(body!.html).not.toContain("<script>eSIM</script>");
    expect(body!.html + body!.text).not.toContain("SENSITIVE-CREDENTIAL");
    expect(body!.text).not.toMatch(/was delivered|is ready to use/i);
  });

  it("rolls back the first-purchase claim with an aborted paid order", async () => {
    const order = await addOrder("active");
    await expect(database.transaction(async (tx) => {
      await tx.insert(schema.walletTransactions).values({ userId: USER, orderId: order.id, type: "debit", amount: 2500, balanceAfter: 17500, reference: order.reference, description: "Order payment" });
      throw new Error("abort purchase");
    })).rejects.toThrow("abort purchase");
    expect(await jobs("first_purchase")).toHaveLength(0);
    expect(await database.select().from(schema.firstPurchaseEmailClaims)).toHaveLength(0);
    await debit(order);
    expect(await jobs("first_purchase")).toHaveLength(1);
  });

  it("keeps one first-purchase claim when two valid purchases are made together", async () => {
    const first = await addOrder("active");
    const second = await addOrder("active");
    await Promise.all([debit(first), debit(second)]);
    expect(await jobs("first_purchase")).toHaveLength(1);
    expect(await database.select().from(schema.firstPurchaseEmailClaims)).toHaveLength(1);
  });

  it("keeps old workers from claiming new event kinds or double-notifying an old password route", async () => {
    await database.insert(schema.bankAccounts).values({ userId: USER, bankCode: "044", bankName: "Bank", accountNumber: "1234567890", accountName: "Ada" });
    // The old application sent this notice itself and never calls the new queuer.
    await database.update(schema.users).set({ passwordHash: "changed-by-old-worker" }).where(eq(schema.users.id, USER));
    expect(await jobs("password_changed")).toHaveLength(0);
    const oldWorker = await pg.query<{ event_kind: string }>("SELECT event_kind FROM wallet_email_outbox WHERE status = 'pending' AND available_at <= now()");
    expect(oldWorker.rows).toEqual([]);
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
  });

  it.each([
    ["bulk", `BLK-${"A".repeat(21)}`, "Bulk purchase: 2 items"],
    ["gift card", "GIFT-PRYVA-SECRET-CODE", "Gift card purchase: PRYVA-SECRET-CODE"],
  ])("recognizes a %s purchase without an order id and never leaks a gift code", async (_kind, reference, description) => {
    await database.insert(schema.walletTransactions).values({ userId: USER, type: "debit", amount: 2000, balanceAfter: 18000, reference, description });
    expect(await jobs("first_purchase")).toHaveLength(1);
    await dispatchWalletEmails(4);
    const body = mailBodies().find((mail) => /first purchase/i.test(mail.subject))!;
    expect(body).toBeDefined();
    expect(body.text).toContain("₦2,000");
    expect(body.text + body.html).not.toContain("PRYVA-SECRET-CODE");
  });

  it("notifies a failed withdrawal only after the failure and wallet refund commit", async () => {
    const [withdrawal] = await database.insert(schema.withdrawals).values({
      userId: USER, amount: 6000, fee: 60, status: "processing", reference: `WD-${"a".repeat(24)}`,
      bankName: "Bank", accountNumber: "1234567890", accountName: "Ada",
    }).returning();
    expect(await refundWithdrawal({ withdrawalId: withdrawal.id, from: ["processing"], to: "failed", note: "Provider refused" })).not.toBeNull();
    expect(await refundWithdrawal({ withdrawalId: withdrawal.id, from: ["processing"], to: "failed", note: "Retry" })).toBeNull();
    expect(await jobs("withdrawal_failed")).toHaveLength(1);
    await dispatchWalletEmails(4);
    const body = mailBodies().find((mail) => mail.subject.includes("Withdrawal could not"))!;
    expect(body).toBeDefined();
    expect(body.text).toContain("amount and fee were returned to your wallet");
    expect(body.html).toContain("hero-withdrawal.jpg");
    expect(body.html + body.text).not.toContain("1234567890");
  });

  it("ignores the old label override with a live key, but never presents a test payment as real", async () => {
    vi.stubEnv("WALLET_EMAIL_TEST_MODE", "true");
    const makeEntry = () => database.insert(schema.walletTransactions).values({
      userId: USER, type: "credit", amount: 2500, balanceAfter: 22500,
      reference: `TOP-${"a".repeat(24)}`, description: "Paystack wallet top-up",
    });
    await makeEntry();
    await dispatchWalletEmails(1);
    const mail = mailBodies()[0];
    expect(mail.subject + mail.text + mail.html).not.toMatch(/\[TEST\]|TEST MODE/);
    expect(mail.html).toContain("hero-wallet.jpg");
    expect(mail.html).toContain('width="38" height="38"');
    expect(mail.html).toContain("font-size:26px");

    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_example");
    await makeEntry();
    expect(await dispatchWalletEmails(1)).toMatchObject({ review: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const held = (await jobs("wallet")).find((job) => job.status === "review");
    expect(held?.lastError).toBe("test_payment_key");
    await database.insert(schema.bankAccounts).values({ userId: USER, bankCode: "044", bankName: "Bank", accountNumber: "1234567890", accountName: "Ada" });
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    expect(mailBodies()[1].subject).toContain("bank account was linked");
  });

  it("exposes provider refusals and review reasons to operators without recipient data", async () => {
    await database.insert(schema.bankAccounts).values({ userId: USER, bankCode: "044", bankName: "Bank", accountNumber: "1234567890", accountName: "Ada" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 }));
    expect(await dispatchWalletEmails(1)).toMatchObject({ retry: 1 });
    const health = await emailQueueStatus();
    expect(health).toMatchObject({ pending: 1, review: 0, groups: [{ status: "pending", eventKind: "bank_linked", reason: "provider_configuration", total: 1 }] });
    expect(JSON.stringify(health)).not.toContain(EMAIL);
    expect(JSON.stringify(health)).not.toContain("1234567890");
  });

  it("quarantines an already-attempted old test payload rather than changing its idempotency body", async () => {
    await database.insert(schema.walletTransactions).values({ userId: USER, type: "credit", amount: 2500, balanceAfter: 22500, reference: `TOP-${"a".repeat(24)}`, description: "Paystack wallet top-up" });
    await database.update(schema.walletEmailOutbox).set({ payload: JSON.stringify({ from: SENDER, to: [EMAIL], subject: "[TEST] Pryva: Top-up", text: "TEST MODE — no real payment", html: "<p>test</p>" }) }).where(eq(schema.walletEmailOutbox.eventKind, "wallet"));
    expect(await dispatchWalletEmails(1)).toMatchObject({ review: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await jobs("wallet"))[0].lastError).toBe("legacy_test_payload");
  });
});

describe("larger shared email branding", () => {
  it("uses the same larger icon and name in auth, wallet, security, number and eSIM mail", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const templates = [
      emailVerificationEmail("Ada", "https://pryvalogs.com/verify-email?token=x"),
      makeWalletEmail({ kind: "wallet", type: "credit", amount: 1000, description: "Paystack wallet top-up", reference: `TOP-${"b".repeat(24)}`, createdAt: at }, EMAIL, SENDER),
      buildSecurityNotice("password_changed", "Ada", at),
      makeNumberCodeEmail({ recipient: EMAIL, sender: SENDER, orderReference: "PRY-1", productName: "Number", planLabel: "One", region: "Nigeria", phoneNumber: null, code: "123456", expiresAt: null, orderUrl: "https://pryvalogs.com/dashboard/orders/1" }),
      makeEsimDeliveryEmail({ recipient: EMAIL, sender: SENDER, orderReference: "PRY-2", productName: "eSIM", planLabel: "1GB", region: "Nigeria", duration: "7 days", activationCode: "LPA:1$example$code", installUrl: null, iccid: null, orderUrl: "https://pryvalogs.com/dashboard/orders/2", attachment: null }),
    ];
    for (const { html } of templates) {
      expect(html).toContain('/images/brand/pryva-mark.png" width="38" height="38"');
      expect(html).toContain("font-size:26px");
      expect(html).toContain("Pryva</td>");
      expect(html).not.toContain("vercel.app");
    }
  });
});

describe("the migration respects existing customers", () => {
  it("marks past buyers without sending them a misleading first-purchase message", async () => {
    const older = new PGlite();
    try {
      await applyMigrations(older, "0032");
      const prior = drizzle(older, { schema });
      await prior.insert(schema.users).values({ id: USER, name: "Ada", email: EMAIL, passwordHash: "hash", walletBalance: 5000 });
      const [oldOrder] = await prior.insert(schema.orders).values({ userId: USER, reference: "OLD", service: "accounts", productSlug: "old", productName: "Old order", planLabel: "One", region: "Global", duration: "One", amount: 1000, status: "delivered", provider: "accounts" }).returning();
      await prior.insert(schema.walletTransactions).values({ userId: USER, orderId: oldOrder.id, type: "debit", amount: 1000, balanceAfter: 4000, reference: "OLD", description: "Old order" });
      await older.exec(await readFile("migrations/0033_account_activity_emails.sql", "utf8"));
      expect(await prior.select().from(schema.firstPurchaseEmailClaims)).toMatchObject([{ userId: USER, source: "historical" }]);
      expect(await prior.select().from(schema.walletEmailOutbox).where(eq(schema.walletEmailOutbox.eventKind, "first_purchase"))).toHaveLength(0);
      const [nextOrder] = await prior.insert(schema.orders).values({ userId: USER, reference: "NEW", service: "accounts", productSlug: "new", productName: "New order", planLabel: "One", region: "Global", duration: "One", amount: 1000, status: "active", provider: "accounts" }).returning();
      await prior.insert(schema.walletTransactions).values({ userId: USER, orderId: nextOrder.id, type: "debit", amount: 1000, balanceAfter: 3000, reference: "NEW", description: "New order" });
      expect(await prior.select().from(schema.walletEmailOutbox).where(eq(schema.walletEmailOutbox.eventKind, "first_purchase"))).toHaveLength(0);
    } finally {
      await older.close();
    }
  }, 60_000);
});
