import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { makeWalletEmail } from "@/lib/wallet-email-template";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import { dispatchWalletEmails } from "@/lib/wallet-email-outbox";
import { GET as cron } from "@/app/api/cron/wallet-emails/route";

const USER = "72e85c0a-9d4a-4d38-a5d0-2a839e05d250";
let pg: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  for (const file of ["0000_base_schema.sql", "0001_google_subject.sql", "0002_shared_rate_limits.sql", "0003_withdrawal_idempotency.sql", "0004_paystack_transfer_reference.sql", "0005_wallet_email_outbox.sql", "0006_order_idempotency.sql", "0007_order_reconciliation_note.sql", "0008_order_provider_cost.sql", "0009_password_reset_tokens.sql", "0010_order_provider_no_default.sql", "0011_email_verification.sql", "0012_topup_payer_name.sql"]) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  mocks.db = database;
}, 30_000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("RESEND_API_KEY", "re_test_secret");
  vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <mail@pryva.test>");
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_test_placeholder");
  vi.stubEnv("WALLET_EMAIL_TEST_MODE", "false");
  await pg.exec('TRUNCATE TABLE "users" CASCADE; TRUNCATE TABLE rate_limit_buckets');
  await database.insert(schema.users).values({ id: USER, name: "Buyer", email: "buyer@example.test", passwordHash: "hash", walletBalance: 20000 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function entry(type = "credit", reference = "TOP-1234567890abcdef12345678", description = "Paystack wallet top-up") {
  const [row] = await database.insert(schema.walletTransactions).values({ userId: USER, type, amount: 2500, balanceAfter: 22500, reference, description }).returning();
  return row;
}

function accepted() { return new Response(JSON.stringify({ id: "msg-123" }), { status: 200, headers: { "content-type": "application/json" } }); }

describe("wallet email outbox on embedded PostgreSQL", () => {
  it("queues each committed wallet movement atomically and rolls back jobs with the transaction", async () => {
    await entry();
    const jobs = await database.select().from(schema.walletEmailOutbox);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ userId: USER, recipient: "buyer@example.test", eventKind: "wallet", status: "pending" });
    await pg.exec(`BEGIN; INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description,reference) VALUES ('${USER}','debit',1000,19000,'Order','PAY-test'); ROLLBACK;`);
    expect(await database.select().from(schema.walletEmailOutbox)).toHaveLength(1);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("sends a committed top-up once even when two workers compete", async () => {
    const transaction = await entry();
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([dispatchWalletEmails(1), dispatchWalletEmails(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_secret", "Idempotency-Key": expect.stringMatching(/^pryva-wallet\//) });
    expect(body).toMatchObject({ from: "Pryva <mail@pryva.test>", to: ["buyer@example.test"], subject: "Pryva: Wallet top-up confirmed" });
    expect(body.text).toContain("₦2,500");
    expect(body.text).toContain("TOP-1234567890abcdef12345678");
    const [job] = await database.select().from(schema.walletEmailOutbox).where(eq(schema.walletEmailOutbox.walletTransactionId, transaction.id));
    expect(job).toMatchObject({ status: "sent", attempts: 1, providerMessageId: "msg-123" });
  });

  it("shares a send budget across workers without starting attempts on throttled jobs", async () => {
    for (let index = 0; index < 8; index++) await entry();
    const fetchMock = vi.fn().mockImplementation(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.all([dispatchWalletEmails(8), dispatchWalletEmails(8)]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(results.some((result) => result.throttled)).toBe(true);
    const jobs = await database.select().from(schema.walletEmailOutbox);
    expect(jobs.filter((job) => job.status === "sent")).toHaveLength(4);
    expect(jobs.filter((job) => job.status === "pending").every((job) => job.firstAttemptAt === null && job.attempts === 0)).toBe(true);
    await pg.exec("UPDATE rate_limit_buckets SET reset_at = now() - interval '1 second'");
    await dispatchWalletEmails(8);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("retries an uncertain send with the identical saved payload and key without changing the ledger", async () => {
    await entry();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(accepted());
    vi.stubGlobal("fetch", fetchMock);
    expect(await dispatchWalletEmails(1)).toMatchObject({ retry: 1 });
    let [job] = await database.select().from(schema.walletEmailOutbox);
    expect(job.status).toBe("pending");
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
    await pg.exec("UPDATE wallet_email_outbox SET available_at = now() - interval '1 second'");
    vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <new-sender@example.test>");
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["Idempotency-Key"]).toBe((first.headers as Record<string, string>)["Idempotency-Key"]);
    [job] = await database.select().from(schema.walletEmailOutbox);
    expect(job).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does not report a send as committed if another worker has taken the lease", async () => {
    await entry();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      await pg.exec("UPDATE wallet_email_outbox SET lock_token = gen_random_uuid()");
      return accepted();
    }));
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 0, retry: 1 });
    expect((await database.select().from(schema.walletEmailOutbox))[0].status).toBe("sending");
  });

  it("holds ambiguous sends beyond the provider's deduplication window for review", async () => {
    await entry();
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal("fetch", fetchMock);
    await pg.exec("UPDATE wallet_email_outbox SET status = 'sending', first_attempt_at = now() - interval '24 hours', locked_until = now() - interval '1 minute'");
    expect(await dispatchWalletEmails(1)).toEqual({ sent: 0, retry: 0, review: 1, throttled: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await database.select().from(schema.walletEmailOutbox))[0]).toMatchObject({ status: "review", lastError: "idempotency_window_elapsed" });
  });

  it("retries a transient payload-read failure without sending, but reviews malformed saved data", async () => {
    await entry();
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal("fetch", fetchMock);
    const select = vi.spyOn(database, "select").mockImplementationOnce(() => { throw new Error("temporary database failure"); });
    expect(await dispatchWalletEmails(1)).toMatchObject({ retry: 1 });
    select.mockRestore();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await database.select().from(schema.walletEmailOutbox))[0]).toMatchObject({ status: "pending", lastError: "notification_unavailable" });
    await pg.exec("UPDATE wallet_email_outbox SET available_at = now() - interval '1 second', payload = '{}' ");
    expect(await dispatchWalletEmails(1)).toMatchObject({ review: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await database.select().from(schema.walletEmailOutbox))[0]).toMatchObject({ status: "review", lastError: "invalid_notification_data" });
  });

  it("does not treat an idempotency conflict as a successful email", async () => {
    await entry();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "invalid_idempotent_request" }), { status: 409 })));
    expect(await dispatchWalletEmails(1)).toMatchObject({ review: 1, sent: 0 });
    expect((await database.select().from(schema.walletEmailOutbox))[0]).toMatchObject({ status: "review", lastError: "idempotency_conflict" });
  });

  it("notifies a saved marketplace delivery without including purchased credentials", async () => {
    const reference = "MKT-abcdef1234567890abcdef123456";
    const [order] = await database.insert(schema.orders).values({
      reference, userId: USER, service: "accounts", productSlug: "listing", productName: "Purchased accounts",
      planLabel: "One account", region: "Global", duration: "Instant", amount: 2500, status: "processing",
      provider: "accounts", accounts: null,
    }).returning();
    await database.update(schema.orders).set({ status: "review", accounts: '["user:secret-password"]' }).where(eq(schema.orders.id, order.id));
    expect(await database.select().from(schema.walletEmailOutbox)).toHaveLength(0);
    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, order.id));
    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, order.id));
    const jobs = await database.select().from(schema.walletEmailOutbox);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ eventKind: "purchase_completed", orderId: order.id });
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal("fetch", fetchMock);
    await dispatchWalletEmails(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.subject).toContain("Purchase marked delivered");
    expect(body.text).toContain(reference);
    expect(body.text + body.html).not.toContain("secret-password");
  });

  it("does not infer purchase completion for unverified providers", async () => {
    const [order] = await database.insert(schema.orders).values({
      reference: "LEGACY-ORDER", userId: USER, service: "numbers", productSlug: "vn-us", productName: "Number",
      planLabel: "One", region: "US", duration: "20 minutes", amount: 2500, status: "active", provider: "fleexa",
    }).returning();
    await database.update(schema.orders).set({ status: "delivered", otpCode: "123456" }).where(eq(schema.orders.id, order.id));
    expect(await database.select().from(schema.walletEmailOutbox)).toHaveLength(0);
  });

  it("queues truthful withdrawal status updates once per transition", async () => {
    const [withdrawal] = await database.insert(schema.withdrawals).values({ userId: USER, amount: 6000, fee: 60, bankName: "Bank", accountNumber: "1234567890", accountName: "Buyer", status: "pending", reference: "WD-abc" }).returning();
    await database.update(schema.withdrawals).set({ status: "processing" }).where(eq(schema.withdrawals.id, withdrawal.id));
    await database.update(schema.withdrawals).set({ status: "processing" }).where(eq(schema.withdrawals.id, withdrawal.id));
    await database.update(schema.withdrawals).set({ status: "completed" }).where(eq(schema.withdrawals.id, withdrawal.id));
    const jobs = await database.select().from(schema.walletEmailOutbox);
    expect(jobs.map((job) => job.eventKind).sort()).toEqual(["withdrawal_completed", "withdrawal_processing"]);
    const fetchMock = vi.fn().mockImplementation(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    await dispatchWalletEmails(4);
    const bodies = fetchMock.mock.calls.map(([, init]) => String(init.body));
    expect(bodies.some((body) => body.includes("not confirmation of a bank payout"))).toBe(true);
    expect(bodies.some((body) => body.includes("marked complete after review"))).toBe(true);
    expect(bodies.join(" ")).not.toContain("1234567890");
  });

  it("never sends from preview and protects the cron with its secret", async () => {
    await entry();
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DATABASE_URL", "");
    expect(await dispatchWalletEmails()).toEqual({ sent: 0, retry: 0, review: 0, throttled: false });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
    vi.stubEnv("CRON_SECRET", "long-worker-secret");
    expect((await cron(new NextRequest("https://pryva.test/api/cron/wallet-emails"))).status).toBe(401);
    const result = await cron(new NextRequest("https://pryva.test/api/cron/wallet-emails", { headers: { authorization: "Bearer long-worker-secret" } }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, sent: 1 });
  });
});

describe("wallet email privacy", () => {
  it("does not leak arbitrary references or bank details in wallet notifications", () => {
    const event = { kind: "wallet" as const, type: "withdrawal", amount: 5000, description: "Withdrawal to Bank (1234567890)", reference: "BANK-1234567890", createdAt: new Date("2026-01-01T00:00:00Z") };
    const mail = makeWalletEmail(event, "buyer@example.test", "Pryva <mail@pryva.test>", false);
    expect(mail.text + mail.html).not.toContain("1234567890");
    expect(mail.text).toContain("not confirmation of a bank payout");
  });

  it("omits gift card codes and labels test payments without claiming a real charge", () => {
    const event = { kind: "wallet" as const, type: "debit", amount: 1000, description: "Gift card purchase: PRYVA-SECRET-CODE", reference: "GIFT-PRYVA-SECRET-CODE", createdAt: new Date("2026-01-01T00:00:00Z") };
    const mail = makeWalletEmail(event, "buyer@example.test", "Pryva <mail@pryva.test>", true);
    expect(mail.subject).toContain("[TEST]");
    expect(mail.text).toContain("no real payment or payout");
    expect(mail.text).toContain("wallet movement only");
    expect(mail.text + mail.html).not.toContain("PRYVA-SECRET-CODE");
  });
});
