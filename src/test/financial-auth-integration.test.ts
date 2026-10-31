import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

// This runs real SQL in embedded PostgreSQL/WASM. Providers and authentication
// are mocked; it is not a multi-server PostgreSQL or live-provider test.
const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  user: vi.fn(),
  session: vi.fn(),
  cookies: vi.fn(),
  getListing: vi.fn(),
  purchase: vi.fn(),
  price: vi.fn(),
  promo: vi.fn(),
  getBanks: vi.fn(),
  resolveBank: vi.fn(),
  createRecipient: vi.fn(),
  initializePayment: vi.fn(),
  verifyPayment: vi.fn(),
  initiateTransfer: vi.fn(),
  verifyTransfer: vi.fn(),
  checkSms: vi.fn(),
  rentalSms: vi.fn(),
  destroySession: vi.fn(),
  googleProfile: vi.fn(),
  exchange: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({
  requireAuthApi: mocks.user, getCurrentUser: mocks.user,
  createSession: mocks.session, destroySession: mocks.destroySession, hashPassword: () => "test-password-hash",
  verifyPassword: (password: string, hash: string) => password === hash,
  SESSION_COOKIE: "pryva_session", SESSION_COOKIE_EMBEDDED: "pryva_session_3p",
}));
vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminApi: async () => ({ user: { id: "admin-id" }, response: null }),
}));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/google", () => ({
  googleConfigured: () => true, exchangeGoogleCode: mocks.exchange, fetchGoogleUser: mocks.googleProfile,
}));
// The real ledger arithmetic is kept (the deletion path writes a forfeiture debit
// through it); only the outbound credit is stubbed.
vi.mock("@/lib/wallet", async (original) => ({
  ...(await original<typeof import("@/lib/wallet")>()),
  creditWallet: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  giftCardIpRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  giftCardUserRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  contactRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  passwordChangeRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  accountDeletionRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  notificationRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  createRateLimiter: () => async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  resetRateLimit: async () => {},
}));
vi.mock("@/lib/accszone", async (original) => {
  const actual = await original<typeof import("@/lib/accszone")>();
  return { ...actual, isAccsZoneConfigured: () => true, getListing: mocks.getListing, purchaseAccounts: mocks.purchase, validatePromo: mocks.promo };
});
vi.mock("@/lib/fleexa", async (original) => {
  const actual = await original<typeof import("@/lib/fleexa")>();
  return { ...actual, checkFleexaSms: mocks.checkSms, getFleexaRentalSms: mocks.rentalSms };
});
vi.mock("@/lib/marketplace-pricing", () => ({
  priceMarketplaceListing: mocks.price,
  applyPromoDiscount: (price: unknown) => price,
}));
vi.mock("@/lib/paystack", () => ({
  isPaystackConfigured: () => true, getBanks: mocks.getBanks,
  resolveBankAccount: mocks.resolveBank, createTransferRecipient: mocks.createRecipient,
  initializePayment: mocks.initializePayment, verifyPayment: mocks.verifyPayment, initiateTransfer: mocks.initiateTransfer,
  verifyTransfer: mocks.verifyTransfer,
}));

const USER = "f5ca2925-6050-49d2-ab89-fc324953ed11";
const REQUEST_ID = "da16d859-1301-4851-a124-b9dddf107333";
const OTHER_REQUEST_ID = "47a7c568-8781-416b-8393-57ed13b89d42";
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let purchaseRoute: typeof import("@/app/api/accounts/purchase/route");
let refundRoute: typeof import("@/app/api/admin/refunds/route");
let bankRoute: typeof import("@/app/api/wallet/bank-accounts/route");
let verifyBankRoute: typeof import("@/app/api/wallet/verify-account/route");
let googleRoute: typeof import("@/app/api/auth/google/callback/route");
let contactRoute: typeof import("@/app/api/contact/route");
let deleteRoute: typeof import("@/app/api/user/delete/route");
let passwordRoute: typeof import("@/app/api/user/password/route");
let sessionsRoute: typeof import("@/app/api/user/sessions/route");
let giftPurchaseRoute: typeof import("@/app/api/gift-cards/purchase/route");
let giftCheckRoute: typeof import("@/app/api/gift-cards/check/route");
let giftRedeemRoute: typeof import("@/app/api/gift-cards/redeem/route");
let topUpRoute: typeof import("@/app/api/wallet/topup/route");
let verifyTopUpRoute: typeof import("@/app/api/wallet/topup/verify/route");
let webhookRoute: typeof import("@/app/api/webhooks/payment/route");
let profileRoute: typeof import("@/app/api/user/profile/route");
let notificationsRoute: typeof import("@/app/api/notifications/route");
let markReadRoute: typeof import("@/app/api/notifications/mark-read/route");
let logoutRoute: typeof import("@/app/api/auth/logout/route");
let syncRoute: typeof import("@/app/api/orders/[id]/sync/route");
let scheduledRoute: typeof import("@/app/api/scheduled-orders/route");
let promoRoute: typeof import("@/app/api/accounts/promo/route");
let withdrawalRoute: typeof import("@/app/api/wallet/withdraw/route");
let adminWithdrawalRoute: typeof import("@/app/api/admin/withdrawals/route");
let integrity: typeof import("@/lib/payment-integrity");
let autoRefund: typeof import("@/lib/auto-refund");
let retention: typeof import("@/lib/retention");

function purchaseRequest(id = REQUEST_ID, origin = "https://pryva.test", type = "application/json") {
  return new NextRequest("https://pryva.test/api/accounts/purchase", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": type },
    // Listing ids are opaque routing tokens: the prefix says which source owns
    // the reference, so a purchase can never be sent to the wrong supplier.
    body: JSON.stringify({ slug: "p2:listing", quantity: 1, requestId: id }),
  });
}
function adminRefund(orderId: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("https://pryva.test/api/admin/refunds", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, ...extra }),
  });
}
function bankRequest(origin = "https://pryva.test", type = "application/json") {
  return new NextRequest("https://pryva.test/api/wallet/bank-accounts", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": type },
    body: JSON.stringify({ bankCode: "044", accountNumber: "1234567890", setDefault: true, bankName: "Spoofed Bank" }),
  });
}
function googleRequest() {
  return new Request("https://pryva.test/api/auth/google/callback?code=test&state=valid");
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(await readFile("migrations/0000_base_schema.sql", "utf8"));
  await pg.exec(await readFile("migrations/0001_google_subject.sql", "utf8"));
  await pg.exec(await readFile("migrations/0002_shared_rate_limits.sql", "utf8"));
  await pg.exec(await readFile("migrations/0003_withdrawal_idempotency.sql", "utf8"));
  await pg.exec(await readFile("migrations/0004_paystack_transfer_reference.sql", "utf8"));
  await pg.exec(await readFile("migrations/0005_wallet_email_outbox.sql", "utf8"));
  await pg.exec(await readFile("migrations/0006_order_idempotency.sql", "utf8"));
  await pg.exec(await readFile("migrations/0007_order_reconciliation_note.sql", "utf8"));
  await pg.exec(await readFile("migrations/0008_order_provider_cost.sql", "utf8"));
  await pg.exec(await readFile("migrations/0009_password_reset_tokens.sql", "utf8"));
  await pg.exec(await readFile("migrations/0010_order_provider_no_default.sql", "utf8"));
  await pg.exec(await readFile("migrations/0011_email_verification.sql", "utf8"));
  await pg.exec(await readFile("migrations/0012_topup_payer_name.sql", "utf8"));
  await pg.exec(await readFile("migrations/0013_disposable_inboxes.sql", "utf8"));
  await pg.exec(await readFile("migrations/0014_admin_audit_log.sql", "utf8"));
  await pg.exec(await readFile("migrations/0015_two_factor.sql", "utf8"));
  await pg.exec(await readFile("migrations/0016_product_reviews.sql", "utf8"));
  await pg.exec(await readFile("migrations/0017_login_lockout.sql", "utf8"));
  await pg.exec(await readFile("migrations/0018_reconciliation_runs.sql", "utf8"));
  await pg.exec(await readFile("migrations/0019_support_tickets.sql", "utf8"));
  await pg.exec(await readFile("migrations/0020_webauthn.sql", "utf8"));
  await pg.exec(await readFile("migrations/0021_referrals.sql", "utf8"));
  await pg.exec(await readFile("migrations/0022_fraud.sql", "utf8"));
  await pg.exec(await readFile("migrations/0023_boost_orders.sql", "utf8"));
  await pg.exec(await readFile("migrations/0024_account_deletions.sql", "utf8"));
  await pg.exec(await readFile("migrations/0025_account_deletion_forfeiture.sql", "utf8"));
  await pg.exec(await readFile("migrations/0026_webhook_events.sql", "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  [purchaseRoute, refundRoute, bankRoute, verifyBankRoute, googleRoute, contactRoute, deleteRoute, passwordRoute, sessionsRoute, autoRefund, giftPurchaseRoute, giftCheckRoute, giftRedeemRoute, topUpRoute, verifyTopUpRoute, webhookRoute, profileRoute, notificationsRoute, markReadRoute, logoutRoute, syncRoute, scheduledRoute, promoRoute, withdrawalRoute, adminWithdrawalRoute, integrity] = await Promise.all([
    import("@/app/api/accounts/purchase/route"), import("@/app/api/admin/refunds/route"),
    import("@/app/api/wallet/bank-accounts/route"), import("@/app/api/wallet/verify-account/route"),
    import("@/app/api/auth/google/callback/route"), import("@/app/api/contact/route"),
    import("@/app/api/user/delete/route"), import("@/app/api/user/password/route"),
    import("@/app/api/user/sessions/route"), import("@/lib/auto-refund"),
    import("@/app/api/gift-cards/purchase/route"), import("@/app/api/gift-cards/check/route"), import("@/app/api/gift-cards/redeem/route"),
    import("@/app/api/wallet/topup/route"), import("@/app/api/wallet/topup/verify/route"), import("@/app/api/webhooks/payment/route"),
    import("@/app/api/user/profile/route"), import("@/app/api/notifications/route"),
    import("@/app/api/notifications/mark-read/route"), import("@/app/api/auth/logout/route"),
    import("@/app/api/orders/[id]/sync/route"), import("@/app/api/scheduled-orders/route"), import("@/app/api/accounts/promo/route"), import("@/app/api/wallet/withdraw/route"), import("@/app/api/admin/withdrawals/route"), import("@/lib/payment-integrity"),
  ]);
  retention = await import("@/lib/retention");
}, 30_000);

afterAll(async () => { await pg?.close(); });
afterEach(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.initializePayment.mockReset();
  mocks.verifyPayment.mockReset();
  mocks.verifyTransfer.mockReset();
  mocks.initiateTransfer.mockReset();
  // Payouts are sent as part of the request now, so the provider has to answer
  // by default: it echoes the request back exactly as Paystack does.
  mocks.initiateTransfer.mockImplementation(async (params: { reference: string; amount: number }) => ({
    status: true,
    data: { transfer_code: "TRF-auto", reference: params.reference, amount: params.amount, currency: "NGN", status: "pending" },
  }));
  mocks.checkSms.mockReset();
  mocks.rentalSms.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("MARKETPLACE_LIVE_PURCHASES", "true");
  vi.stubEnv("PAYSTACK_SECRET_KEY", "test-secret");
  await pg.exec('TRUNCATE TABLE "users" CASCADE');
  // The delivery log has no foreign key on purpose (it must outlive the rows it
  // describes), so it is cleared explicitly.
  await pg.exec('TRUNCATE TABLE "webhook_events"');
  await database.insert(schema.users).values({ id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: 10000 });
  mocks.user.mockResolvedValue({ id: USER, email: "buyer@example.com", name: "Buyer", walletBalance: 10000 });
  mocks.getListing.mockResolvedValue({ id: 7, slug: "listing", title: "Test listing", price: "1.00", available_stock: 10, category: null, subcategory: null });
  mocks.price.mockResolvedValue({ totalNgn: 2000, unitNgn: 2000, discountNgn: 0, profitNgn: 500 });
  mocks.purchase.mockResolvedValue({ order_id: 42, accounts: ["user:secret"] });
  mocks.getBanks.mockResolvedValue([{ code: "044", name: "Access Bank" }]);
  mocks.resolveBank.mockResolvedValue({ status: true, data: { account_name: "Verified Person", account_number: "1234567890", bank_id: 1 } });
  mocks.createRecipient.mockResolvedValue({ status: true, data: { recipient_code: "RCP-test" } });
  mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_google_state" ? { value: "valid" } : undefined });
  mocks.exchange.mockResolvedValue("access-token");
  mocks.googleProfile.mockResolvedValue({ sub: "google-subject-1", email: "new@example.com", name: "Google User", emailVerified: true });
  mocks.session.mockResolvedValue("session");
});

describe("withdrawal request idempotency on embedded PostgreSQL", () => {
  const BANK_ID = "6db3231e-312b-4f81-82a2-2d078e784b6f";
  const ALT_BANK_ID = "b64ac036-949b-4013-94c5-1839db204d6e";

  function withdrawalRequest(requestId = REQUEST_ID, amount = 6000, bankAccountId = BANK_ID) {
    return new NextRequest("https://pryva.test/api/wallet/withdraw", {
      method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ requestId, amount, bankAccountId }),
    });
  }
  async function addBank(id = BANK_ID, userId = USER) {
    await database.insert(schema.bankAccounts).values({ id, userId, bankName: "Test Bank", bankCode: "044", accountNumber: "1234567890", accountName: "Test Customer", recipientCode: "RCP-test" });
    // A balance that can be withdrawn always arrived through a completed deposit,
    // and the deposit is what records the name a payout has to match -- so these
    // fixtures model one rather than a wallet that cannot exist in production.
    // The payer name is deliberately not the profile name ("Buyer"): the reference
    // is the name frozen at settlement, precisely because the profile field is
    // editable afterwards.
    await database.insert(schema.paymentTopups).values({
      reference: `TOP-fund-${id.slice(0, 8)}`, // "reference" is varchar(40)
      userId,
      amount: 10_000,
      status: "completed",
      paidAt: new Date(),
      payerName: "Test Customer",
    });
  }

  it("does not let a profile rename redirect money to a third party", async () => {
    await addBank();

    // This is why the reference is a column on the deposit and not `users.name`.
    // The customer renames their profile to match a bank account that is not
    // theirs, and the profile endpoint happily allows it -- the frozen deposit
    // name does not move with it, so the payout is still refused.
    await database.update(schema.users).set({ name: "Mule Account" }).where(eq(schema.users.id, USER));
    await database.update(schema.bankAccounts).set({ accountName: "Mule Account" }).where(eq(schema.bankAccounts.id, BANK_ID));
    mocks.user.mockResolvedValue({ id: USER, email: "buyer@example.com", name: "Mule Account", walletBalance: 10000 });

    const response = await withdrawalRoute.POST(withdrawalRequest());

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("same name");
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.walletBalance).toBe(10000);
    expect(await database.select().from(schema.withdrawals)).toHaveLength(0);
  });

  it("writes the provider reference before the money is asked for, and sends it in the same request", async () => {
    await addBank();
    mocks.initiateTransfer.mockImplementationOnce(async (params: { reference: string; amount: number; currency: string }) => {
      // Read the database from inside the provider call: the row has to be
      // claimed and named *before* the request leaves, or a crash mid-call leaves
      // a debit nobody can trace to a transfer.
      const [during] = await database.select().from(schema.withdrawals);
      expect(during).toMatchObject({ status: "processing", paystackReference: `wd-${during.id.replace(/-/g, "")}` });
      expect(params).toMatchObject({ reference: during.paystackReference, amount: 600000, currency: "NGN" });
      expect(String(params.reference)).toMatch(/^[a-z0-9_-]{16,50}$/);
      return { status: true, data: { transfer_code: "TRF-test", reference: params.reference, amount: 600000, currency: "NGN", status: "pending" } };
    });

    const submitted = await withdrawalRoute.POST(withdrawalRequest());
    expect(submitted.status).toBe(200);
    const body = await submitted.json();
    // No approval step: the customer's request is the payout.
    expect(body.withdrawal.status).toBe("processing");
    expect(body.message).toContain("Payout sent to your bank");
    const [stored] = await database.select().from(schema.withdrawals);
    expect(stored).toMatchObject({ status: "processing", paystackReference: `wd-${stored.id.replace(/-/g, "")}`, transferReference: "TRF-test" });
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(3940);
  });

  it("refunds instead of leaving the money stranded when the provider refuses the payout", async () => {
    await addBank();
    mocks.initiateTransfer.mockResolvedValueOnce({
      status: false, message: "Your balance is not enough to process this transfer", data: undefined as never,
    } as never);
    const submitted = await withdrawalRoute.POST(withdrawalRequest());
    expect(submitted.status).toBe(200);
    const body = await submitted.json();
    expect(body.withdrawal.status).toBe("failed");
    expect(body.message).toContain("returned to your wallet");
    expect(body.newBalance).toBe(10000);
    const [stored] = await database.select().from(schema.withdrawals);
    expect(stored.status).toBe("failed");
    expect(stored.failureReason).toContain("refused");
    const ledger = await database.select().from(schema.walletTransactions);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({ type: "refund", amount: stored.amount + stored.fee, balanceAfter: 10000 });
  });

  it("never refunds a payout whose outcome it could not confirm", async () => {
    await addBank();
    // A timeout can arrive after Paystack accepted the transfer. Refunding here
    // is the one mistake that pays the customer twice.
    mocks.initiateTransfer.mockRejectedValueOnce(new Error("socket hang up"));
    const submitted = await withdrawalRoute.POST(withdrawalRequest());
    expect(submitted.status).toBe(200);
    const body = await submitted.json();
    expect(body.withdrawal.status).toBe("processing");
    const [stored] = await database.select().from(schema.withdrawals);
    expect(stored.status).toBe("processing");
    // The wallet stays debited and the ledger has no refund to give back.
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(3940);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("refuses a request whose bank account cannot receive a payout, before any debit", async () => {
    await database.insert(schema.bankAccounts).values({
      id: BANK_ID, userId: USER, bankName: "Test Bank", bankCode: "044",
      accountNumber: "1234567890", accountName: "Test Customer", recipientCode: null,
    });
    await database.insert(schema.paymentTopups).values({
      reference: "TOP-norecipient", userId: USER, amount: 5000, status: "completed",
      paidAt: new Date(), payerName: "Test Customer",
    });
    const response = await withdrawalRoute.POST(new NextRequest("https://pryva.test/api/wallet/withdraw", {
      method: "POST",
      headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ requestId: "5c2a1f0e-0000-4000-8000-000000000009", amount: 3000, bankAccountId: BANK_ID }),
    }));
    expect(response.status).toBe(409);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
    expect(await database.select().from(schema.withdrawals)).toHaveLength(0);
    expect(mocks.initiateTransfer).not.toHaveBeenCalled();
  });

  it("still settles a legacy queued request by hand, at most once", async () => {
    await addBank();
    // Rows created before payouts became instant are `pending` with no provider
    // reference; the admin action stays for them and for the exception queue.
    await database.insert(schema.withdrawals).values({
      userId: USER, amount: 6000, fee: 60, bankName: "Test Bank", accountNumber: "1234567890",
      accountName: "Test Customer", recipientCode: "RCP-test", status: "pending", reference: "WD-legacy0000000000000001",
    });
    const [legacy] = await database.select().from(schema.withdrawals);
    const approve = () => new NextRequest("https://pryva.test/api/admin/withdrawals", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: legacy.id, action: "approve" }) });
    const results = await Promise.all([adminWithdrawalRoute.PUT(approve()), adminWithdrawalRoute.PUT(approve())]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(mocks.initiateTransfer).toHaveBeenCalledTimes(1);
    const [stored] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, legacy.id));
    expect(stored).toMatchObject({ status: "processing", paystackReference: `wd-${legacy.id.replace(/-/g, "")}`, transferReference: "TRF-auto" });
  });

  it("enforces unique Paystack transfer references in the migrated database", async () => {
    await addBank();
    const { withdrawal: first } = await (await withdrawalRoute.POST(withdrawalRequest())).json();
    const { withdrawal: second } = await (await withdrawalRoute.POST(withdrawalRequest(OTHER_REQUEST_ID, 2000))).json();
    const reference = `wd-${first.id.replace(/-/g, "")}`;
    await database.update(schema.withdrawals).set({ paystackReference: reference }).where(eq(schema.withdrawals.id, first.id));
    await expect(database.update(schema.withdrawals).set({ paystackReference: reference }).where(eq(schema.withdrawals.id, second.id))).rejects.toThrow();
  });

  it("replays the same request without a second debit, including after the bank is removed", async () => {
    await addBank();
    const first = await withdrawalRoute.POST(withdrawalRequest());
    expect(first.status).toBe(200);
    const firstReceipt = await first.json();
    expect(firstReceipt).toMatchObject({ replayed: false, withdrawal: { amount: 6000, fee: 60, status: "processing", createdAt: expect.any(String) } });
    await database.delete(schema.bankAccounts).where(eq(schema.bankAccounts.id, BANK_ID));
    const repeated = await withdrawalRoute.POST(withdrawalRequest());
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ replayed: true, withdrawal: { id: firstReceipt.withdrawal.id, reference: firstReceipt.withdrawal.reference } });
    expect((await withdrawalRoute.POST(withdrawalRequest(REQUEST_ID, 5000))).status).toBe(409);
    expect((await withdrawalRoute.POST(withdrawalRequest(REQUEST_ID, 6000, ALT_BANK_ID))).status).toBe(409);
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.walletBalance).toBe(3940);
    expect(await database.select().from(schema.withdrawals)).toHaveLength(1);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("deduplicates simultaneous requests with the same key", async () => {
    await addBank();
    const responses = await Promise.all([
      withdrawalRoute.POST(withdrawalRequest()),
      withdrawalRoute.POST(withdrawalRequest()),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const receipts = await Promise.all(responses.map((response) => response.json()));
    expect(new Set(receipts.map((entry) => entry.withdrawal.id)).size).toBe(1);
    expect(receipts.map((entry) => entry.replayed).sort()).toEqual([false, true]);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(3940);
    expect(await database.select().from(schema.withdrawals)).toHaveLength(1);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("rolls back the idempotency claim and debit when the ledger fails, allowing a safe retry", async () => {
    await addBank();
    await pg.exec("ALTER TABLE wallet_transactions ADD CONSTRAINT fail_withdrawal CHECK (type <> 'withdrawal')");
    try {
      expect((await withdrawalRoute.POST(withdrawalRequest())).status).toBe(500);
      expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
      expect(await database.select().from(schema.withdrawals)).toHaveLength(0);
    } finally {
      await pg.exec('ALTER TABLE wallet_transactions DROP CONSTRAINT fail_withdrawal');
    }
    expect((await withdrawalRoute.POST(withdrawalRequest())).status).toBe(200);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(3940);
  });

  it("scopes keys to the customer rather than sharing them between users", async () => {
    await addBank();
    expect((await withdrawalRoute.POST(withdrawalRequest())).status).toBe(200);
    const otherUser = "a5717bca-15b8-43f0-8ce0-83d795fbd616";
    await database.insert(schema.users).values({ id: otherUser, name: "Other", email: "other@example.com", passwordHash: "hash", walletBalance: 10000 });
    await addBank(ALT_BANK_ID, otherUser);
    mocks.user.mockResolvedValue({ id: otherUser, email: "other@example.com" });
    expect((await withdrawalRoute.POST(withdrawalRequest(REQUEST_ID, 6000, ALT_BANK_ID))).status).toBe(200);
    expect(await database.select().from(schema.withdrawals)).toHaveLength(2);
  });
});

describe("ledger integrity", () => {
  it("treats withdrawal entries as debits and refund entries as credits", async () => {
    await database.update(schema.users).set({ walletBalance: 4500 }).where(eq(schema.users.id, USER));
    await database.insert(schema.walletTransactions).values([
      { userId: USER, type: "credit", amount: 10000, balanceAfter: 10000, description: "Top-up", reference: "integrity-credit" },
      { userId: USER, type: "withdrawal", amount: 6000, balanceAfter: 4000, description: "Withdrawal", reference: "integrity-withdrawal" },
      { userId: USER, type: "refund", amount: 500, balanceAfter: 4500, description: "Refund", reference: "integrity-refund" },
    ]);
    expect(await integrity.checkWalletIntegrity(USER)).toEqual({ valid: true, issues: [] });
    await database.insert(schema.walletTransactions).values({ userId: USER, type: "unrecognized", amount: 1, balanceAfter: 4500, description: "Unknown", reference: "integrity-unknown" });
    expect((await integrity.checkWalletIntegrity(USER)).issues).toContain("Unknown transaction type: unrecognized");
  });

  it("recognizes the actual refund ledger type when checking a refunded order", async () => {
    const [order] = await database.insert(schema.orders).values({ reference: "integrity-order", userId: USER, service: "numbers", productSlug: "test", productName: "Test", planLabel: "Single", region: "Nigeria", duration: "Single", amount: 1000, provider: "fleexa", status: "refunded" }).returning();
    await database.insert(schema.walletTransactions).values([
      { userId: USER, orderId: order.id, type: "debit", amount: 1000, balanceAfter: 9000, description: "Purchase", reference: "integrity-debit" },
      { userId: USER, orderId: order.id, type: "refund", amount: 1000, balanceAfter: 10000, description: "Refund", reference: "integrity-order-refund" },
    ]);
    expect(await integrity.checkOrderIntegrity(order.id)).toEqual({ valid: true, issues: [] });
  });
});

describe("marketplace money safety", () => {
  it("blocks preview funds, default-disabled checkout, cross-origin and non-JSON requests before provider or database writes", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await purchaseRoute.POST(purchaseRequest())).status).toBe(503);
    vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
    vi.stubEnv("MARKETPLACE_LIVE_PURCHASES", "");
    expect((await purchaseRoute.POST(purchaseRequest())).status).toBe(503);
    vi.stubEnv("MARKETPLACE_LIVE_PURCHASES", "true");
    expect((await purchaseRoute.POST(purchaseRequest(REQUEST_ID, "https://evil.pryva.test"))).status).toBe(403);
    expect((await purchaseRoute.POST(purchaseRequest(REQUEST_ID, "https://pryva.test", "text/plain"))).status).toBe(415);
    expect(mocks.getListing).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
    expect(await database.select().from(schema.orders)).toHaveLength(0);
  });

  it("atomically records the debit, order and ledger; replaying the request returns the same receipt", async () => {
    const first = await purchaseRoute.POST(purchaseRequest());
    expect(first.status).toBe(200);
    const receipt = await first.json();
    expect(receipt.accounts).toEqual(["user:secret"]);
    const [order] = await database.select().from(schema.orders);
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    const [ledger] = await database.select().from(schema.walletTransactions);
    expect(order).toMatchObject({ status: "delivered", amount: 2000, accounts: '["user:secret"]', referenceCode: "42" });
    expect(order.reference.length).toBeLessThanOrEqual(32);
    expect(order.providerRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.walletBalance).toBe(8000);
    expect(ledger).toMatchObject({ orderId: order.id, amount: 2000, type: "debit", balanceAfter: 8000 });
    const replay = await purchaseRoute.POST(purchaseRequest());
    expect(replay.status).toBe(200);
    expect((await replay.json()).order.reference).toBe(receipt.order.reference);
    expect(mocks.getListing).toHaveBeenCalledTimes(1);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("does not retry or refund an uncertain purchase, and blocks refunds while it is in flight", async () => {
    let rejectPurchase!: (error: Error) => void;
    mocks.purchase.mockReturnValueOnce(new Promise((_, reject) => { rejectPurchase = reject; }));
    const first = purchaseRoute.POST(purchaseRequest());
    await vi.waitFor(() => expect(mocks.purchase).toHaveBeenCalledTimes(1));
    const [processing] = await database.select().from(schema.orders);
    expect(processing.status).toBe("processing");
    expect((await refundRoute.POST(adminRefund(processing.id))).status).toBe(409);
    expect((await purchaseRoute.POST(purchaseRequest())).status).toBe(202);
    const differentIntent = await purchaseRoute.POST(purchaseRequest(OTHER_REQUEST_ID));
    expect(differentIntent.status).toBe(202);
    expect((await differentIntent.json()).order.reference).toBe(processing.reference);
    rejectPurchase(new Error("supplier accepted request but connection dropped"));
    const response = await first;
    expect(response.status).toBe(202);
    expect((await response.json()).pending).toBe(true);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
    const [review] = await database.select().from(schema.orders);
    expect(review.status).toBe("review");
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(8000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
    expect((await refundRoute.POST(adminRefund(review.id))).status).toBe(409);
    expect((await refundRoute.POST(adminRefund(review.id, { reconciliationConfirmed: true }))).status).toBe(400);
    expect((await refundRoute.POST(adminRefund(review.id, { reconciliationConfirmed: true, reason: "Verified with supplier" }))).status).toBe(200);
    expect((await refundRoute.POST(adminRefund(review.id, { reconciliationConfirmed: true, reason: "Verified" }))).status).toBe(409);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(2);
  });

  it("rolls back the debit and order when the ledger insert fails", async () => {
    await pg.exec('ALTER TABLE "wallet_transactions" ADD CONSTRAINT "test_no_debit" CHECK ("type" <> \'debit\')');
    try {
      const response = await purchaseRoute.POST(purchaseRequest());
      expect(response.status).toBe(202); // A failed COMMIT response must not promise no charge.
      expect(mocks.purchase).not.toHaveBeenCalled();
      expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
      expect(await database.select().from(schema.orders)).toHaveLength(0);
      expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
    } finally {
      await pg.exec('ALTER TABLE "wallet_transactions" DROP CONSTRAINT "test_no_debit"');
    }
  });

  it("keeps an incomplete receipt for review without crediting the wallet", async () => {
    mocks.purchase.mockResolvedValueOnce({ order_id: 42, accounts: [] });
    expect((await purchaseRoute.POST(purchaseRequest())).status).toBe(202);
    expect((await database.select().from(schema.orders))[0].status).toBe("review");
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(8000);
  });

  it("returns complete credentials with a warning if saving them fails, without logging the secrets", async () => {
    await pg.exec('ALTER TABLE "orders" ADD CONSTRAINT "test_no_accounts" CHECK ("accounts" IS NULL)');
    try {
      const response = await purchaseRoute.POST(purchaseRequest());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.accounts).toEqual(["user:secret"]);
      expect(body.warning).toContain("could not save");
      expect((await database.select().from(schema.orders))[0].status).toBe("review");
      expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain("user:secret");
    } finally {
      await pg.exec('ALTER TABLE "orders" DROP CONSTRAINT "test_no_accounts"');
    }
  });

  it("does not contact the supplier when the wallet lacks funds", async () => {
    await database.update(schema.users).set({ walletBalance: 1000 }).where(eq(schema.users.id, USER));
    expect((await purchaseRoute.POST(purchaseRequest())).status).toBe(402);
    expect(mocks.purchase).not.toHaveBeenCalled();
    expect(await database.select().from(schema.orders)).toHaveLength(0);
  });
});

describe("undelivered number refund SQL", () => {
  it("only claims timed-out single numbers without a code and never double-credits", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const common = { userId: USER, productSlug: "test", productName: "Test", planLabel: "Test", region: "Nigeria", amount: 1000, status: "active", provider: "fleexa", createdAt: new Date(Date.now() - 60 * 60_000) };
    await database.insert(schema.orders).values([
      { ...common, reference: "no-code", service: "numbers", duration: "Single verification · 20 min window" },
      { ...common, reference: "with-code", service: "numbers", duration: "Single verification · 20 min window", otpCode: "123456" },
      { ...common, reference: "rental", service: "numbers", duration: "7 days" },
      { ...common, reference: "esim", service: "esim", duration: "30 days" },
    ]);
    expect(await autoRefund.processAutoRefunds()).toEqual({ refunded: 1, cancelled: 0 });
    expect(await autoRefund.processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    const rows = await database.select().from(schema.orders);
    expect(rows.find((order) => order.reference === "no-code")?.status).toBe("refunded");
    for (const reference of ["with-code", "rental", "esim"]) {
      expect(rows.find((order) => order.reference === reference)?.status).toBe("active");
    }
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(11000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("rolls back the claim and balance when a refund ledger entry fails", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await database.insert(schema.orders).values({ reference: "refund-rollback", userId: USER, service: "numbers", productSlug: "test", productName: "Test", planLabel: "Single", region: "Nigeria", duration: "Single verification · 20 min window", amount: 1000, provider: "fleexa", createdAt: new Date(Date.now() - 60 * 60_000) });
    await pg.exec('ALTER TABLE "wallet_transactions" ADD CONSTRAINT "test_no_refund" CHECK ("type" <> \'refund\')');
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await autoRefund.processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
      expect((await database.select().from(schema.orders))[0].status).toBe("active");
      expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
      expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
      await pg.exec('ALTER TABLE "wallet_transactions" DROP CONSTRAINT "test_no_refund"');
    }
  });
});

describe("bank recipients", () => {
  it("verifies bank accounts only with a valid provider response and never in preview", async () => {
    expect((await verifyBankRoute.POST(bankRequest("https://evil.pryva.test"))).status).toBe(403);
    vi.stubEnv("DATABASE_URL", "");
    expect((await verifyBankRoute.POST(bankRequest())).status).toBe(503);
    expect(mocks.resolveBank).not.toHaveBeenCalled();
    vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
    mocks.resolveBank.mockResolvedValueOnce({ status: false, data: { account_name: "Fake", account_number: "1234567890" } });
    expect((await verifyBankRoute.POST(bankRequest())).status).toBe(400);
    const response = await verifyBankRoute.POST(bankRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).accountName).toBe("Verified Person");
  });

  it("stores the directory name when the documented Paystack resolve response has no bank_name", async () => {
    const response = await bankRoute.POST(bankRequest());
    expect(response.status).toBe(200);
    const [bank] = await database.select().from(schema.bankAccounts);
    expect(bank).toMatchObject({ userId: USER, bankName: "Access Bank", accountName: "Verified Person", recipientCode: "RCP-test", isDefault: 1 });
    expect(mocks.createRecipient).toHaveBeenCalledWith({ name: "Verified Person", accountNumber: "1234567890", bankCode: "044" });
  });

  it("refuses to save when the resolved account name differs from what the customer reviewed", async () => {
    const requestForName = (expectedAccountName: unknown) => new NextRequest("https://pryva.test/api/wallet/bank-accounts", {
      method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ bankCode: "044", accountNumber: "1234567890", expectedAccountName }),
    });
    expect((await bankRoute.POST(requestForName("Different Person"))).status).toBe(409);
    expect((await bankRoute.POST(requestForName(""))).status).toBe(400);
    expect(mocks.createRecipient).not.toHaveBeenCalled();
    expect(await database.select().from(schema.bankAccounts)).toHaveLength(0);
    expect((await bankRoute.POST(requestForName("Verified Person"))).status).toBe(200);
    expect(mocks.createRecipient).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin, non-JSON, preview, and unverified account responses", async () => {
    expect((await bankRoute.POST(bankRequest("https://evil.pryva.test"))).status).toBe(403);
    expect((await bankRoute.POST(bankRequest("https://pryva.test", "text/plain"))).status).toBe(415);
    vi.stubEnv("DATABASE_URL", "");
    expect((await bankRoute.POST(bankRequest())).status).toBe(503);
    vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
    mocks.resolveBank.mockResolvedValueOnce({ status: false, data: { account_name: "Bad", account_number: "1234567890" } });
    expect((await bankRoute.POST(bankRequest())).status).toBe(400);
    mocks.resolveBank.mockResolvedValueOnce({ status: true, data: { account_name: "Bad", account_number: "0000000000" } });
    expect((await bankRoute.POST(bankRequest())).status).toBe(400);
    expect(mocks.createRecipient).not.toHaveBeenCalled();
    expect(await database.select().from(schema.bankAccounts)).toHaveLength(0);
  });
});

describe("Google subject binding and account protection", () => {
  it("does not link an unverified password signup to a Google identity by email", async () => {
    mocks.googleProfile.mockResolvedValueOnce({ sub: "victim-subject", email: "buyer@example.com", name: "Victim", emailVerified: true });
    const response = await googleRoute.GET(googleRequest());
    expect(response.headers.get("location")).toBe("/login?error=google-account-exists");
    expect(mocks.session).not.toHaveBeenCalled();
    const [existing] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(existing.googleSubject).toBeNull();
    expect(existing.passwordHash).toBe("hash");
  });

  it("creates and later signs in only the same verified subject; different subjects and email changes fail closed", async () => {
    expect((await googleRoute.GET(googleRequest())).headers.get("location")).toBe("/dashboard");
    const [created] = await database.select().from(schema.users).where(eq(schema.users.email, "new@example.com"));
    expect(created.googleSubject).toBe("google-subject-1");
    expect(mocks.session).toHaveBeenCalledWith(created.id, expect.any(Request));
    expect((await googleRoute.GET(googleRequest())).headers.get("location")).toBe("/dashboard");
    expect(mocks.session).toHaveBeenCalledTimes(2);
    mocks.googleProfile.mockResolvedValueOnce({ sub: "different-subject", email: "new@example.com", name: "Other", emailVerified: true });
    expect((await googleRoute.GET(googleRequest())).headers.get("location")).toBe("/login?error=google-account-exists");
    mocks.googleProfile.mockResolvedValueOnce({ sub: "google-subject-1", email: "changed@example.com", name: "Other", emailVerified: true });
    expect((await googleRoute.GET(googleRequest())).headers.get("location")).toBe("/login?error=google-account-exists");
    mocks.googleProfile.mockResolvedValueOnce({ sub: "another", email: "another@example.com", name: "Other", emailVerified: false });
    expect((await googleRoute.GET(googleRequest())).headers.get("location")).toBe("/login?error=google-exchange");
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });

  it("rejects a malicious next cookie even after successful Google authentication", async () => {
    mocks.cookies.mockResolvedValueOnce({ get: (name: string) => ({ value: name === "pryva_google_state" ? "valid" : "%2F%2Fevil.example" }) });
    expect((await googleRoute.GET(googleRequest())).headers.get("location")).toBe("/dashboard");
  });

  it("changes the password and revokes other sessions atomically, including embedded-cookie sessions", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await database.insert(schema.sessions).values([
      { userId: USER, token: "current-token", expiresAt },
      { userId: USER, token: "other-token", expiresAt },
    ]);
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session_3p" ? { value: "current-token" } : undefined });
    const request = (origin: string) => new NextRequest("https://pryva.test/api/user/password", {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "hash", newPassword: "NewPassword123" }),
    });
    expect((await passwordRoute.POST(request("https://evil.pryva.test"))).status).toBe(403);
    expect((await passwordRoute.POST(request("https://pryva.test"))).status).toBe(200);
    expect((await database.select().from(schema.users))[0].passwordHash).toBe("test-password-hash");
    expect((await database.select().from(schema.sessions)).map((session) => session.token)).toEqual(["current-token"]);
  });

  it("prevents cross-origin session revocation and preserves the embedded current session", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await database.insert(schema.sessions).values([
      { userId: USER, token: "current-token", expiresAt },
      { userId: USER, token: "other-token", expiresAt },
    ]);
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session_3p" ? { value: "current-token" } : undefined });
    const request = (origin: string) => new NextRequest("https://pryva.test/api/user/sessions", {
      method: "DELETE", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ revokeAll: true }),
    });
    expect((await sessionsRoute.DELETE(request("https://evil.pryva.test"))).status).toBe(403);
    expect((await sessionsRoute.DELETE(request("https://pryva.test"))).status).toBe(200);
    expect((await database.select().from(schema.sessions)).map((session) => session.token)).toEqual(["current-token"]);
  });

  it("refuses a cross-origin deletion and changes nothing", async () => {
    const request = new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST",
      headers: { origin: "https://evil.pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "buyer@example.com", password: "hash" }),
    });
    expect((await deleteRoute.POST(request)).status).toBe(403);
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.deletedAt).toBeNull();
    expect(user.email).toBe("buyer@example.com");
  });

  it("closes the account, scrubs the identity, and keeps the financial record", async () => {
    await database.insert(schema.orders).values({ reference: "ORDER-1", userId: USER, service: "numbers", productSlug: "test", productName: "Test", planLabel: "Single", region: "NG", duration: "20 min", amount: 1000, provider: "fleexa" });
    await database.insert(schema.walletTransactions).values({ userId: USER, type: "debit", amount: 1000, balanceAfter: 9000, description: "Order ORDER-1", reference: "LEDGER-1" });
    await database.insert(schema.sessions).values({ userId: USER, token: "current-token", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    await database.insert(schema.passwordResetTokens).values({ userId: USER, tokenHash: "deadbeef", expiresAt: new Date(Date.now() + 60_000) });
    await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));
    mocks.user.mockResolvedValue({ id: USER, email: "buyer@example.com", name: "Buyer", walletBalance: 0 });
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "current-token" } : undefined });

    const request = new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST",
      headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "buyer@example.com", password: "hash" }),
    });
    const response = await deleteRoute.POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, deleted: true, retained: { orders: 1, walletTransactions: 1 } });

    // The row survives — 20+ tables point at it — but it is no longer a person.
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user).toBeDefined();
    expect(user.deletedAt).not.toBeNull();
    expect(user.name).toBe("Deleted account");
    expect(user.email).toBe(`deleted+${USER}@deleted.pryva.invalid`);
    expect(user.deletedEmailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.googleSubject).toBeNull();
    expect(user.walletBalance).toBe(0);
    // A password nobody knows, in the ordinary format.
    expect(user.passwordHash).not.toBe("hash");

    // Credentials and devices are gone.
    expect(await database.select().from(schema.sessions)).toHaveLength(0);
    expect(await database.select().from(schema.passwordResetTokens)).toHaveLength(0);

    // The record is not: this is the whole point of closing, not deleting.
    expect(await database.select().from(schema.orders)).toHaveLength(1);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);

    // And there is a receipt saying what was retained.
    const [receipt] = await database.select().from(schema.accountDeletions);
    expect(receipt.userId).toBe(USER);
    expect(receipt.reason).toBe("self_service");
    expect(receipt.retained).toMatchObject({ orders: 1, walletTransactions: 1 });

    // Closing twice is not a second deletion. In production the session row is
    // gone, so this is a 401; here the auth helper is mocked, so the typed address
    // no longer matches either. Either way: refused, and no second receipt.
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "current-token" } : undefined });
    const again = await deleteRoute.POST(request);
    expect([400, 401, 409]).toContain(again.status);
    expect(await database.select().from(schema.accountDeletions)).toHaveLength(1);
  });

  it("closes with a balance only when the forfeiture is acknowledged, and writes it down", async () => {
    await database.insert(schema.sessions).values({ userId: USER, token: "current-token", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "current-token" } : undefined });

    const post = (payload: unknown) => deleteRoute.POST(new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST", headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));

    // Without the acknowledgement the request is refused, and it names the amount.
    const refused = await post({ confirm: "buyer@example.com", password: "hash" });
    expect(refused.status).toBe(409);
    const refusal = await refused.json();
    expect(refusal.code).toBe("FORFEITURE_NOT_ACKNOWLEDGED");
    expect(refusal.error).toContain("10,000");
    const [untouched] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(untouched.deletedAt).toBeNull();
    expect(untouched.walletBalance).toBe(10_000);

    // With it, the account closes and the balance is forfeited — in the ledger.
    const closed = await post({ confirm: "buyer@example.com", password: "hash", forfeitAcknowledged: true });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ ok: true, deleted: true, forfeited: 10_000 });

    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.deletedAt).not.toBeNull();
    expect(user.walletBalance).toBe(0);
    expect(user.email).toBe(`deleted+${USER}@deleted.pryva.invalid`);

    // The money did not vanish: the ledger says where it went, and the
    // `previous ± amount = balance_after` invariant the nightly close checks holds.
    const [forfeiture] = await database.select().from(schema.walletTransactions);
    expect(forfeiture).toMatchObject({
      userId: USER,
      type: "debit",
      amount: 10_000,
      balanceAfter: 0,
      description: "Account closed — balance forfeited",
    });

    const [receipt] = await database.select().from(schema.accountDeletions);
    expect(receipt.forfeited).toBe(10_000);
  });

  it("holds a closure while a payout is still moving", async () => {
    await database.insert(schema.sessions).values({ userId: USER, token: "current-token", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    await database.insert(schema.withdrawals).values({
      userId: USER, amount: 6000, bankName: "Test Bank", accountNumber: "1234567890",
      accountName: "Test Customer", reference: "WD-pending-1", status: "processing",
    });
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "current-token" } : undefined });
    await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));

    const response = await deleteRoute.POST(new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST", headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "buyer@example.com", password: "hash", forfeitAcknowledged: true }),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("WITHDRAWAL_IN_FLIGHT");
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.deletedAt).toBeNull();
  });

  it("refuses a session that has been open too long, and a wrong password", async () => {
    await database.insert(schema.sessions).values({ userId: USER, token: "old-token", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(Date.now() - 30 * 60_000) });
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "old-token" } : undefined });
    await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));

    const body = JSON.stringify({ confirm: "buyer@example.com", password: "hash" });
    const stale = await deleteRoute.POST(new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST", headers: { origin: "https://pryva.test", "content-type": "application/json" }, body,
    }));
    expect(stale.status).toBe(403);
    expect((await stale.json()).code).toBe("SESSION_TOO_OLD");

    // A fresh session, but the wrong password, still changes nothing.
    await database.delete(schema.sessions);
    await database.insert(schema.sessions).values({ userId: USER, token: "fresh-token", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "fresh-token" } : undefined });
    const wrong = await deleteRoute.POST(new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST", headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "buyer@example.com", password: "not-the-password" }),
    }));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe("PASSWORD_MISMATCH");

    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.deletedAt).toBeNull();
  });

  it("requires the address to be typed, and the password where one exists", async () => {
    await database.insert(schema.sessions).values({ userId: USER, token: "current-token", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "pryva_session" ? { value: "current-token" } : undefined });
    await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));

    const post = (payload: unknown) => deleteRoute.POST(new NextRequest("https://pryva.test/api/user/delete", {
      method: "POST", headers: { origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect((await post({ confirm: "someone@else.com", password: "hash" })).status).toBe(400);
    expect((await post({ confirm: "buyer@example.com" })).status).toBe(400);
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.deletedAt).toBeNull();
  });

  it("associates support messages with the authenticated user, not an asserted user ID", async () => {
    const request = new NextRequest("https://pryva.test/api/contact", { method: "POST", headers: { "content-type": "application/json", origin: "https://pryva.test" }, body: JSON.stringify({ name: "Buyer", email: "buyer@example.com", topic: "Wallet", message: "Please review my purchase.", userId: "someone-else" }) });
    expect((await contactRoute.POST(request)).status).toBe(200);
    const [message] = await database.select().from(schema.contactMessages);
    expect(message.userId).toBe(USER);
  });
});

describe("gift-card SQL and bearer-code safety", () => {
  const RECIPIENT = "04a23636-d857-4a38-bb19-1230fc07c832";
  function giftRequest(path: string, body: unknown, origin = "https://pryva.test") {
    return new NextRequest(`https://pryva.test/api/gift-cards/${path}`, {
      method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("debits the purchaser, checks without URL secrets, and credits a card exactly once", async () => {
    await database.insert(schema.users).values({ id: RECIPIENT, name: "Recipient", email: "recipient@example.com", passwordHash: "hash", walletBalance: 0 });
    const purchase = await giftPurchaseRoute.POST(giftRequest("purchase", { amount: 1000, recipientEmail: "recipient@example.com" }));
    expect(purchase.status).toBe(200);
    expect(purchase.headers.get("cache-control")).toContain("no-store");
    const { code } = await purchase.json();
    expect(code).toMatch(/^PRYVA-/);
    expect((await giftCheckRoute.GET()).status).toBe(405);
    const checked = await giftCheckRoute.POST(giftRequest("check", { code }));
    expect(checked.status).toBe(200);
    expect(checked.headers.get("cache-control")).toContain("no-store");
    expect(await checked.json()).toMatchObject({ amount: 1000, status: "active" });
    mocks.user.mockResolvedValue({ id: RECIPIENT, email: "recipient@example.com", name: "Recipient", walletBalance: 0 });
    expect((await giftRedeemRoute.POST(giftRequest("redeem", { code: code.toLowerCase() }))).status).toBe(200);
    expect((await giftRedeemRoute.POST(giftRequest("redeem", { code }))).status).toBe(400);
    const [buyer] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    const [recipient] = await database.select().from(schema.users).where(eq(schema.users.id, RECIPIENT));
    expect(buyer.walletBalance).toBe(9000);
    expect(recipient.walletBalance).toBe(1000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(2);
  });

  it("rejects invalid or cross-origin gift-card requests before changing funds", async () => {
    expect((await giftPurchaseRoute.POST(giftRequest("purchase", { amount: 1000 }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await giftPurchaseRoute.POST(giftRequest("purchase", { amount: 1000, recipientEmail: "x".repeat(250) }))).status).toBe(400);
    expect((await giftRedeemRoute.POST(giftRequest("redeem", { code: "not-a-code" }))).status).toBe(400);
    expect(await database.select().from(schema.giftCards)).toHaveLength(0);
    const [buyer] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(buyer.walletBalance).toBe(10000);
  });
});

describe("Paystack top-up safety", () => {
  const request = (path: string, body: unknown, origin = "https://pryva.test", type = "application/json") => new NextRequest(`https://pryva.test/api/wallet/topup${path}`, {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  it("rejects cross-origin, oversized and preview attempts before contacting Paystack", async () => {
    expect((await topUpRoute.POST(request("", { amount: 2500 }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await verifyTopUpRoute.POST(request("/verify", { reference: "TOP-12345" }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await topUpRoute.POST(request("", "x".repeat(2049)))).status).toBe(413);
    expect((await verifyTopUpRoute.POST(request("/verify", "x".repeat(2049)))).status).toBe(413);
    vi.stubEnv("DATABASE_URL", "");
    expect((await topUpRoute.POST(request("", { amount: 2500 }))).status).toBe(503);
    expect((await verifyTopUpRoute.POST(request("/verify", { reference: "TOP-12345" }))).status).toBe(503);
    expect(mocks.initializePayment).not.toHaveBeenCalled();
    expect(mocks.verifyPayment).not.toHaveBeenCalled();
    expect(await database.select().from(schema.paymentTopups)).toHaveLength(0);
  });

  it("does not create a checkout when the configured return origin is unsafe", async () => {
    for (const value of ["http://public.example", "https://name:password@example.com", "https://pryva.test/path", "https://pryva.test/?x=1", "javascript:alert(1)"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      expect((await topUpRoute.POST(request("", { amount: 2500 }))).status).toBe(503);
    }
    expect(mocks.initializePayment).not.toHaveBeenCalled();
    expect(await database.select().from(schema.paymentTopups)).toHaveLength(0);
  });

  it("does not silently ignore a selected method and leaves channel choice to Paystack", async () => {
    const rejected = await topUpRoute.POST(request("", { amount: 2500, method: "card" }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("Paystack checkout");
    expect(mocks.initializePayment).not.toHaveBeenCalled();
    mocks.initializePayment.mockImplementationOnce(async ({ reference }: { reference: string }) => ({
      status: true, data: { authorization_url: "https://checkout.paystack.com/session", reference },
    }));
    expect((await topUpRoute.POST(request("", { amount: 2500 }))).status).toBe(200);
    const init = mocks.initializePayment.mock.calls[0][0];
    expect(init).not.toHaveProperty("channels");
    expect(init.amount).toBe("250000");
    expect(init.currency).toBe("NGN");
    expect(init.callback_url).toBe("https://pryva.test/dashboard/wallet?topup=return");
    expect(JSON.parse(init.metadata)).toMatchObject({ userId: USER, type: "wallet_topup", cancel_action: `${init.callback_url}&reference=${init.reference}` });
  });

  it("freezes the depositor's name when a payment settles, and never rewrites it", async () => {
    const reference = "TOP-payer-name";
    await database.insert(schema.paymentTopups).values({ reference, userId: USER, amount: 2500 });
    const settled = { reference, amount: 250000, currency: "NGN", status: "success" };
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: settled });

    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(200);

    const [topup] = await database.select().from(schema.paymentTopups).where(eq(schema.paymentTopups.reference, reference));
    expect(topup.payerName).toBe("Buyer");

    // A retried delivery arrives after the profile has been edited. The name is
    // written only on the pending -> completed transition, so the retry cannot
    // overwrite the frozen one with a name nobody was paid under.
    await database.update(schema.users).set({ name: "Renamed Later" }).where(eq(schema.users.id, USER));
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: settled });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(200);

    const [after] = await database.select().from(schema.paymentTopups).where(eq(schema.paymentTopups.reference, reference));
    expect(after.payerName).toBe("Buyer");
  });

  it("treats in-flight and unknown provider statuses as unconfirmed, not failed or credited", async () => {
    const reference = "TOP-pending-test";
    await database.insert(schema.paymentTopups).values({ reference, userId: USER, amount: 2500 });
    const payment = { reference, amount: 250000, currency: "NGN" };
    for (const status of ["ongoing", "pending", "processing", "queued", "abandoned", "unexpected"]) {
      mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, status } });
      const result = await verifyTopUpRoute.POST(request("/verify", { reference }));
      expect(result.status).toBe(202);
      expect(await result.json()).toMatchObject({ ok: true, status: "pending" });
    }
    for (const status of ["failed", "reversed"]) {
      mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, status } });
      const result = await verifyTopUpRoute.POST(request("/verify", { reference }));
      expect(result.status).toBe(402);
      expect(await result.json()).toMatchObject({ ok: false, status: "failed" });
    }
    mocks.verifyPayment.mockResolvedValueOnce({ status: false, data: null });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(502);
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, amount: 100000, status: "pending" } });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(409);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("only verifies references belonging to the authenticated customer", async () => {
    const other = "04a23636-d857-4a38-bb19-1230fc07c832";
    await database.insert(schema.users).values({ id: other, name: "Other", email: "other@example.com", passwordHash: "hash", walletBalance: 0 });
    await database.insert(schema.paymentTopups).values({ reference: "TOP-another-user", userId: other, amount: 2500 });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference: "TOP-another-user" }))).status).toBe(404);
    expect((await verifyTopUpRoute.POST(request("/verify", { reference: "TOP-unknown-ref" }))).status).toBe(404);
    expect(mocks.verifyPayment).not.toHaveBeenCalled();
  });

  it("does not direct users to a non-Paystack or mismatched checkout", async () => {
    mocks.initializePayment.mockImplementationOnce(async ({ reference }: { reference: string }) => ({
      status: true, data: { authorization_url: "https://checkout.paystack.com.evil.test/steal", reference },
    }));
    expect((await topUpRoute.POST(request("", { amount: 2500 }))).status).toBe(500);
    mocks.initializePayment.mockResolvedValueOnce({ status: true, data: { authorization_url: "https://checkout.paystack.com/safe", reference: "wrong" } });
    expect((await topUpRoute.POST(request("", { amount: 2500 }))).status).toBe(500);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("names the mismatching field in the log so a stranded deposit is diagnosable", async () => {
    mocks.initializePayment.mockImplementationOnce(async ({ reference }: { reference: string }) => ({
      status: true, data: { authorization_url: "https://checkout.paystack.com/session", reference },
    }));
    const initialized = await topUpRoute.POST(request("", { amount: 2500 }));
    expect(initialized.status).toBe(200);
    const { reference } = await initialized.json();
    const payment = { status: "success", reference, amount: 250000, currency: "NGN", customer: { email: "buyer@example.com" } };

    // A stringified amount is what parsePaystackResponse's unchecked `as T` cast
    // lets through, and under `!==` it is indistinguishable from a missing one.
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, amount: "250000" } });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(409);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "Top-up verification returned mismatched payment details",
      expect.objectContaining({
        reference,
        mismatch: expect.stringMatching(/amount: no usable integer.*typeof string/),
      }),
    );

    mocks.log.warn.mockClear();
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, amount: 250001 } });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(409);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "Top-up verification returned mismatched payment details",
      expect.objectContaining({
        mismatch: expect.stringContaining("amount: provider requested 250001 kobo, expected 250000 kobo from the stored 2500 naira"),
      }),
    );

    mocks.log.warn.mockClear();
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, currency: "USD" } });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(409);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "Top-up verification returned mismatched payment details",
      expect.objectContaining({
        mismatch: expect.stringContaining('currency: provider sent "USD", expected "NGN"'),
      }),
    );

    // Every rejected attempt left the wallet untouched.
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("credits a top-up Paystack grossed up to pass its fee to the customer", async () => {
    mocks.initializePayment.mockImplementationOnce(async ({ reference }: { reference: string }) => ({
      status: true, data: { authorization_url: "https://checkout.paystack.com/session", reference },
    }));
    const initialized = await topUpRoute.POST(request("", { amount: 2500 }));
    expect(initialized.status).toBe(200);
    const { reference } = await initialized.json();

    // With "Pass fees to customers" enabled in the Paystack dashboard, the
    // customer is charged ceil((net + N100) / 0.985) and that gross is reported
    // as `amount`, while `requested_amount` stays the net we asked for. For
    // N2,500 the gross is 263960 kobo: a fractional naira figure that matches
    // neither the stored amount nor a whole naira, so matching on `amount`
    // rejected a payment the customer had genuinely made.
    mocks.verifyPayment.mockResolvedValueOnce({
      status: true,
      data: {
        status: "success", reference, currency: "NGN", customer: { email: "buyer@example.com" },
        amount: 263960, requested_amount: 250000, fees: 13959,
      },
    });
    const response = await verifyTopUpRoute.POST(request("/verify", { reference }));
    expect(response.status).toBe(200);
    // The wallet is credited the net that was recorded, never the gross charged.
    expect(await response.json()).toMatchObject({
      ok: true, status: "completed", credited: true,
      receipt: { reference, amount: 2500, balanceAfter: 12500 },
    });
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(12500);

    // Matching the net must not have loosened the check: a charge that came in
    // short of what we requested is still refused.
    mocks.initializePayment.mockImplementationOnce(async ({ reference: ref }: { reference: string }) => ({
      status: true, data: { authorization_url: "https://checkout.paystack.com/session", reference: ref },
    }));
    const shortReference = (await (await topUpRoute.POST(request("", { amount: 2500 }))).json()).reference;
    mocks.log.warn.mockClear();
    mocks.verifyPayment.mockResolvedValueOnce({
      status: true,
      data: {
        status: "success", reference: shortReference, currency: "NGN", customer: { email: "buyer@example.com" },
        amount: 240000, requested_amount: 250000, fees: 0,
      },
    });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference: shortReference }))).status).toBe(409);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "Top-up verification returned mismatched payment details",
      expect.objectContaining({
        mismatch: expect.stringMatching(/charged 240000 kobo is less than the 250000 kobo requested/),
      }),
    );
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(12500);
  });

  it("verifies reference, currency and exact naira amount and deduplicates the signed webhook", async () => {
    mocks.initializePayment.mockImplementationOnce(async ({ reference }: { reference: string }) => ({
      status: true, data: { authorization_url: "https://checkout.paystack.com/session", reference },
    }));
    const initialized = await topUpRoute.POST(request("", { amount: 2500 }));
    expect(initialized.status).toBe(200);
    const { reference } = await initialized.json();
    expect(reference).toMatch(/^TOP-[0-9a-f]{24}$/);
    const [pending] = await database.select().from(schema.paymentTopups);
    expect(pending).toMatchObject({ reference, userId: USER, amount: 2500, status: "pending" });

    const payment = { status: "success", reference, amount: 250000, currency: "NGN", customer: { email: "buyer@example.com" } };
    for (const invalid of [
      { currency: undefined }, { currency: "USD" }, { reference: "TOP-other" },
      { amount: 250001 }, { amount: "250000" }, { amount: 250100 },
    ]) {
      mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, ...invalid } });
      expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(409);
    }
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, customer: { email: "other@example.com" } } });
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(403);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);

    mocks.verifyPayment.mockResolvedValue({ status: true, data: payment });
    const first = await verifyTopUpRoute.POST(request("/verify", { reference }));
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ ok: true, status: "completed", credited: true, receipt: { reference, amount: 2500, balanceAfter: 12500, creditedAt: expect.any(String) } });
    const retry = await verifyTopUpRoute.POST(request("/verify", { reference }));
    expect(await retry.json()).toMatchObject({ ok: true, status: "completed", credited: false, reason: "already_credited", receipt: firstBody.receipt });
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: { ...payment, status: "reversed" } });
    const reversed = await verifyTopUpRoute.POST(request("/verify", { reference }));
    expect(reversed.status).toBe(409);
    expect((await reversed.json()).error).toContain("credited earlier");

    const webhookBody = JSON.stringify({ event: "charge.success", data: { ...payment, metadata: { userId: USER, type: "wallet_topup" } } });
    const signature = createHmac("sha512", "test-secret").update(webhookBody).digest("hex");
    const webhook = await webhookRoute.POST(new NextRequest("https://pryva.test/api/webhooks/payment", {
      method: "POST", headers: { "x-paystack-signature": signature }, body: webhookBody,
    }));
    expect(await webhook.json()).toMatchObject({ ok: true, duplicate: true });
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(12500);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("lets a signed webhook credit first and returns the same ledger receipt on callback", async () => {
    const reference = "TOP-webhook-first";
    await database.insert(schema.paymentTopups).values({ reference, userId: USER, amount: 2500 });
    const payment = { status: "success", reference, amount: 250000, currency: "NGN", customer: { email: "buyer@example.com" } };
    const webhookBody = JSON.stringify({ event: "charge.success", data: { ...payment, metadata: JSON.stringify({ userId: USER, type: "wallet_topup" }) } });
    const signature = createHmac("sha512", "test-secret").update(webhookBody).digest("hex");
    const webhook = await webhookRoute.POST(new NextRequest("https://pryva.test/api/webhooks/payment", { method: "POST", headers: { "x-paystack-signature": signature }, body: webhookBody }));
    expect(await webhook.json()).toMatchObject({ ok: true, duplicate: false });
    mocks.verifyPayment.mockResolvedValueOnce({ status: true, data: payment });
    const callback = await verifyTopUpRoute.POST(request("/verify", { reference }));
    expect(await callback.json()).toMatchObject({ status: "completed", credited: false, reason: "already_credited", receipt: { reference, amount: 2500, balanceAfter: 12500 } });
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(12500);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("rolls back a failed ledger insert and allows a safe retry", async () => {
    const reference = "TOP-ledger-test";
    await database.insert(schema.paymentTopups).values({ reference, userId: USER, amount: 2500 });
    mocks.verifyPayment.mockResolvedValue({ status: true, data: { status: "success", reference, amount: 250000, currency: "NGN" } });
    await pg.exec('ALTER TABLE "wallet_transactions" ADD CONSTRAINT "test_no_credit" CHECK ("type" <> \'credit\')');
    try {
      const failed = await verifyTopUpRoute.POST(request("/verify", { reference }));
      expect(failed.status).toBe(502);
      expect((await failed.json()).error).not.toContain("will still arrive");
      expect((await database.select().from(schema.paymentTopups))[0].status).toBe("pending");
      expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
      expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
    } finally {
      await pg.exec('ALTER TABLE "wallet_transactions" DROP CONSTRAINT "test_no_credit"');
    }
    expect((await verifyTopUpRoute.POST(request("/verify", { reference }))).status).toBe(200);
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(12500);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });
});

describe("payout settlement from the provider's own events", () => {
  const BANK = "3f0f7d5e-2b1c-4a6f-9d1e-6a2b3c4d5e6f";

  function eventBody(event: string, data: Record<string, unknown>) {
    return JSON.stringify({ event, data });
  }
  function signed(body: string) {
    return new NextRequest("https://pryva.test/api/webhooks/payment", {
      method: "POST",
      headers: { "x-paystack-signature": createHmac("sha512", "test-secret").update(body).digest("hex") },
      body,
    });
  }
  const send = (event: string, data: Record<string, unknown>) => webhookRoute.POST(signed(eventBody(event, data)));

  /** A payout that left on request: wallet debited, row in flight, provider accepted. */
  async function inFlightPayout(amount = 5000, requestId = "5c2a1f0e-0000-4000-8000-000000000001") {
    await database.insert(schema.bankAccounts).values({
      id: BANK, userId: USER, bankName: "Test Bank", bankCode: "044",
      accountNumber: "1234567890", accountName: "Test Customer", recipientCode: "RCP-test",
    });
    // The name check compares the payout destination with the name frozen on a
    // settled deposit, so a realistic fixture has one.
    await database.insert(schema.paymentTopups).values({
      reference: `TOP-payout-${amount}`, userId: USER, amount, status: "completed",
      paidAt: new Date(), payerName: "Test Customer",
    });
    const created = await withdrawalRoute.POST(new NextRequest("https://pryva.test/api/wallet/withdraw", {
      method: "POST",
      headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
      body: JSON.stringify({ requestId, amount, bankAccountId: BANK }),
    }));
    const body = await created.json();
    if (created.status !== 200) throw new Error(`withdrawal fixture failed: ${JSON.stringify(body)}`);
    const providerReference = `wd-${String(body.withdrawal.id).replace(/-/g, "")}`;
    // No approval step exists any more: the request is the payout.
    expect(mocks.initiateTransfer).toHaveBeenCalled();
    const [row] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, body.withdrawal.id));
    expect(row).toMatchObject({ status: "processing", paystackReference: providerReference });
    expect(row.transferReference).toBe("TRF-auto");
    return { row, providerReference, fee: row.fee };
  }

  async function balance() {
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    return user.walletBalance;
  }

  it("completes an in-flight payout on transfer.success and never pays it twice", async () => {
    const { row, providerReference, fee } = await inFlightPayout(5000);
    const afterRequest = await balance();
    expect(afterRequest).toBe(10000 - 5000 - fee);
    expect(row.completedAt).toBeNull();

    const first = await send("transfer.success", {
      status: "success", reference: providerReference, amount: 500000, currency: "NGN", transfer_code: "TRF-1",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, outcome: "settled" });

    const [settled] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(settled.status).toBe("completed");
    expect(settled.completedAt).toBeInstanceOf(Date);
    expect(settled.transferReference).toBe("TRF-1");
    // Settlement moves money out of our balance, not back into the wallet.
    expect(await balance()).toBe(afterRequest);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);

    const replay = await send("transfer.success", {
      status: "success", reference: providerReference, amount: 500000, currency: "NGN", transfer_code: "TRF-1",
    });
    expect(await replay.json()).toMatchObject({ ok: true, outcome: "already_settled" });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
    expect(await balance()).toBe(afterRequest);
  });

  it("refunds the wallet, once, when the provider says the payout failed", async () => {
    const { row, providerReference } = await inFlightPayout(5000, "5c2a1f0e-0000-4000-8000-000000000002");
    const debited = await balance();
    expect(debited).toBeLessThan(10000);

    const failed = await send("transfer.failed", {
      status: "failed", reference: providerReference, amount: 500000, currency: "NGN",
      transfer_code: "TRF-2", reason: "declined by the recipient bank",
    });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ ok: true, outcome: "refunded" });

    const [row2] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(row2.status).toBe("failed");
    expect(row2.failureReason).toContain("declined by the recipient bank");
    expect(row2.failureReason).toContain("refunded");

    // Exactly what the request took: amount plus fee.
    expect(await balance()).toBe(10000);
    const ledger = await database.select().from(schema.walletTransactions);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({ type: "refund", amount: row.amount + row.fee, balanceAfter: 10000 });

    const replay = await send("transfer.failed", {
      status: "failed", reference: providerReference, amount: 500000, currency: "NGN", transfer_code: "TRF-2",
    });
    expect(await replay.json()).toMatchObject({ ok: true, outcome: "already_failed" });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(2);
    expect(await balance()).toBe(10000);
  });

  it("refunds a payout the bank reverses after it looked settled", async () => {
    const { row, providerReference } = await inFlightPayout(4000, "5c2a1f0e-0000-4000-8000-000000000003");
    await send("transfer.success", { status: "success", reference: providerReference, amount: 400000, currency: "NGN", transfer_code: "TRF-3" });
    const [completed] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(completed.status).toBe("completed");

    const reversal = await send("transfer.reversed", {
      status: "reversed", reference: providerReference, amount: 400000, currency: "NGN", transfer_code: "TRF-3",
    });
    expect(await reversal.json()).toMatchObject({ ok: true, outcome: "refunded" });
    expect(await balance()).toBe(10000);
    const [after] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(after.status).toBe("failed");
    expect(after.failureReason).toContain("reversed");
  });

  it("refuses a contradictory event rather than crediting on it", async () => {
    const { row, providerReference } = await inFlightPayout(3000, "5c2a1f0e-0000-4000-8000-000000000004");
    await send("transfer.success", { status: "success", reference: providerReference, amount: 300000, currency: "NGN", transfer_code: "TRF-4" });
    const settledBalance = await balance();

    // A plain failure cannot follow a success. The wallet is not credited and the
    // row is left as it was for a person to read.
    const contradictory = await send("transfer.failed", {
      status: "failed", reference: providerReference, amount: 300000, currency: "NGN", transfer_code: "TRF-4",
    });
    expect(await contradictory.json()).toMatchObject({ ok: true, outcome: "held" });
    expect(await balance()).toBe(settledBalance);
    const [after] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(after.status).toBe("completed");
  });

  it("refuses an event whose amount or currency disagrees with our record", async () => {
    const { row, providerReference } = await inFlightPayout(2500, "5c2a1f0e-0000-4000-8000-000000000005");
    const before = await balance();

    const wrongAmount = await send("transfer.success", {
      status: "success", reference: providerReference, amount: 1, currency: "NGN", transfer_code: "TRF-5",
    });
    expect(wrongAmount.status).toBe(400);
    const wrongCurrency = await send("transfer.success", {
      status: "success", reference: providerReference, amount: 250000, currency: "USD", transfer_code: "TRF-5",
    });
    expect(wrongCurrency.status).toBe(400);

    const [after] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(after.status).toBe("processing");
    expect(after.completedAt).toBeNull();
    expect(await balance()).toBe(before);
  });

  it("acknowledges an event for a transfer it does not know, without moving money", async () => {
    const response = await send("transfer.success", {
      status: "success", reference: "wd-00000000000000000000000000000000", amount: 100000, currency: "NGN", transfer_code: "TRF-x",
    });
    // 200 so the provider stops retrying: no retry can conjure the row.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, outcome: "unknown_reference" });
    expect(mocks.log.error).toHaveBeenCalledWith(
      expect.stringContaining("no withdrawal"),
      expect.objectContaining({ reference: "wd-00000000000000000000000000000000" }),
    );
    expect(await balance()).toBe(10000);
  });

  it("settles a payout the provider never reported, by asking, in the sweep", async () => {
    const { row, providerReference } = await inFlightPayout(5000, "5c2a1f0e-0000-4000-8000-000000000007");
    // Older than the sweep's window, which is what makes it a candidate.
    await database.update(schema.withdrawals)
      .set({ createdAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(schema.withdrawals.id, row.id));
    const payouts = await import("@/lib/payouts");

    // Not settled yet: the provider says it is still processing.
    mocks.verifyTransfer.mockResolvedValueOnce({
      status: true, message: "ok",
      data: { transfer_code: "TRF-auto", status: "processing", reference: providerReference, amount: 500000, currency: "NGN" },
    });
    const pendingRun = await payouts.reconcileInFlightPayouts();
    expect(pendingRun.checked).toBeGreaterThanOrEqual(1);
    expect(pendingRun.settled).toBe(0);
    const [stillProcessing] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(stillProcessing.status).toBe("processing");

    // Now the provider says it landed.
    mocks.verifyTransfer.mockResolvedValueOnce({
      status: true, message: "ok",
      data: { transfer_code: "TRF-auto", status: "success", reference: providerReference, amount: 500000, currency: "NGN" },
    });
    const settledRun = await payouts.reconcileInFlightPayouts();
    expect(settledRun.settled).toBe(1);
    const [settled] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(settled.status).toBe("completed");
    expect(settled.completedAt).toBeInstanceOf(Date);
  });

  it("records every delivery, and records nothing from a body it does not trust", async () => {
    const { providerReference } = await inFlightPayout(5000, "5c2a1f0e-0000-4000-8000-000000000008");
    await send("transfer.success", {
      status: "success", reference: providerReference, amount: 500000, currency: "NGN", transfer_code: "TRF-8",
    });
    const recorded = await database.select().from(schema.webhookEvents);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      event: "transfer.success",
      reference: providerReference,
      signatureValid: true,
      outcome: "settled",
    });

    // A forged body carries an attacker's text; none of it may be stored.
    const forged = JSON.stringify({ event: "transfer.success", data: { reference: "attacker-chosen", amount: 1, currency: "NGN" } });
    await webhookRoute.POST(new NextRequest("https://pryva.test/api/webhooks/payment", {
      method: "POST",
      headers: { "x-paystack-signature": createHmac("sha512", "wrong-secret").update(forged).digest("hex") },
      body: forged,
    }));
    const after = await database.select().from(schema.webhookEvents);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ event: "unverified", reference: null, signatureValid: false, outcome: "rejected_signature" });
    expect(JSON.stringify(after[1])).not.toContain("attacker-chosen");
  });

  it("answers the operator's question: are payout events arriving?", async () => {
    const activity = await import("@/lib/webhook-events");

    // Nothing delivered yet.
    const empty = await activity.recentWebhookActivity();
    expect(empty.verdict).toBe("silent");

    // A top-up settles, which proves the endpoint works but not that transfers do.
    await database.insert(schema.webhookEvents).values({ event: "charge.success", reference: "TOP-one", signatureValid: true, outcome: "credited" });
    const topupsOnly = await activity.recentWebhookActivity();
    expect(topupsOnly.verdict).toBe("only_topups");
    expect(topupsOnly.explanation).toContain("transfer");

    // And now a payout event, which is the one that matters here.
    await database.insert(schema.webhookEvents).values({ event: "transfer.success", reference: "wd-one", signatureValid: true, outcome: "settled" });
    const receiving = await activity.recentWebhookActivity();
    expect(receiving.verdict).toBe("receiving");
    expect(receiving.counts).toMatchObject({ "charge.success": 1, "transfer.success": 1 });
    expect(receiving.lastDeliveryAt).toBeInstanceOf(Date);
  });

  it("refuses a transfer event that is not signed with the configured secret", async () => {
    const { row, providerReference } = await inFlightPayout(1500, "5c2a1f0e-0000-4000-8000-000000000006");
    const body = eventBody("transfer.success", {
      status: "success", reference: providerReference, amount: 150000, currency: "NGN", transfer_code: "TRF-6",
    });
    const forged = await webhookRoute.POST(new NextRequest("https://pryva.test/api/webhooks/payment", {
      method: "POST",
      headers: { "x-paystack-signature": createHmac("sha512", "wrong-secret").update(body).digest("hex") },
      body,
    }));
    expect(forged.status).toBe(401);
    const [after] = await database.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id));
    expect(after.status).toBe("processing");
  });
});

describe("profile and notification mutation guards", () => {
  const jsonRequest = (path: string, method: string, body: unknown, origin = "https://pryva.test") => new NextRequest(`https://pryva.test${path}`, {
    method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });

  it("validates profile size and origin before updating the account", async () => {
    expect((await profileRoute.PUT(jsonRequest("/api/user/profile", "PUT", { name: "Attacker" }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await profileRoute.PUT(jsonRequest("/api/user/profile", "PUT", { name: "x".repeat(121) }))).status).toBe(400);
    expect((await profileRoute.PUT(jsonRequest("/api/user/profile", "PUT", { name: "x".repeat(2049) }))).status).toBe(413);
    expect((await profileRoute.PUT(jsonRequest("/api/user/profile", "PUT", { name: "  Updated Buyer  " }))).status).toBe(200);
    expect((await database.select().from(schema.users))[0].name).toBe("Updated Buyer");
  });

  it("reports total unread counts across pages and only changes this user's notifications", async () => {
    const other = "04a23636-d857-4a38-bb19-1230fc07c832";
    await database.insert(schema.users).values({ id: other, name: "Other", email: "other@example.com", passwordHash: "hash", walletBalance: 0 });
    const rows = await database.insert(schema.notifications).values([
      { userId: USER, title: "One", message: "One", read: 0 },
      { userId: USER, title: "Two", message: "Two", read: 0 },
      { userId: USER, title: "Three", message: "Three", read: 1 },
      { userId: other, title: "Private", message: "Private", read: 0 },
    ]).returning();
    const page = await notificationsRoute.GET(new NextRequest("https://pryva.test/api/notifications?limit=1&offset=1"));
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(await page.json()).toMatchObject({ notifications: expect.arrayContaining([expect.any(Object)]), total: 3, unreadCount: 2 });
    expect((await notificationsRoute.GET(new NextRequest("https://pryva.test/api/notifications?limit=99999"))).status).toBe(400);
    expect((await notificationsRoute.PATCH(jsonRequest("/api/notifications", "PATCH", { markAllRead: true }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await markReadRoute.POST(jsonRequest("/api/notifications/mark-read", "POST", { markAll: true }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await markReadRoute.POST(jsonRequest("/api/notifications/mark-read", "POST", { notificationIds: Array(101).fill(rows[0].id) }))).status).toBe(400);
    expect((await markReadRoute.POST(jsonRequest("/api/notifications/mark-read", "POST", { notificationIds: [rows[0].id, rows[3].id] }))).status).toBe(200);
    expect((await database.select().from(schema.notifications).where(eq(schema.notifications.id, rows[3].id)))[0].read).toBe(0);
    expect((await notificationsRoute.PATCH(jsonRequest("/api/notifications", "PATCH", { markAllRead: true }))).status).toBe(200);
    expect((await database.select().from(schema.notifications).where(eq(schema.notifications.userId, USER))).every((n) => n.read === 1)).toBe(true);
    expect((await database.select().from(schema.notifications).where(eq(schema.notifications.id, rows[3].id)))[0].read).toBe(0);
  });

  it("does not log a user out from a cross-origin request", async () => {
    expect((await logoutRoute.POST(new Request("https://pryva.test/api/auth/logout", { method: "POST", headers: { origin: "https://evil.pryva.test" } }))).status).toBe(403);
    expect(mocks.destroySession).not.toHaveBeenCalled();
    expect((await logoutRoute.POST(new Request("https://pryva.test/api/auth/logout", { method: "POST", headers: { origin: "https://pryva.test" } }))).status).toBe(200);
    expect(mocks.destroySession).toHaveBeenCalledOnce();
  });
});

describe("order sync and scheduler safety", () => {
  it("does not overwrite a refunded order with a stale provider poll", async () => {
    const [order] = await database.insert(schema.orders).values({
      reference: "OLD-LIVE-ORDER", userId: USER, service: "numbers", productSlug: "vn-ng", productName: "Number",
      planLabel: "Single", region: "NG", duration: "20 min", amount: 1000, status: "active",
      provider: "fleexa", providerRequestId: "provider-123", expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    let finish!: (value: unknown) => void;
    mocks.checkSms.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const syncing = syncRoute.GET(new Request(`https://pryva.test/api/orders/${order.id}/sync`), { params: Promise.resolve({ id: order.id }) });
    await vi.waitFor(() => expect(mocks.checkSms).toHaveBeenCalledOnce());
    await database.update(schema.orders).set({ status: "refunded", refundedAt: new Date() }).where(eq(schema.orders.id, order.id));
    finish({ code: "123456", message: "code 123456", status: "delivered" });
    const response = await syncing;
    expect(await response.json()).toMatchObject({ status: "refunded", otpCode: null, synced: false });
    const [saved] = await database.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(saved.status).toBe("refunded");
    expect(saved.otpCode).toBeNull();
  });

  it("keeps a rental active after a code so a later message can still be synced", async () => {
    const [order] = await database.insert(schema.orders).values({
      reference: "OLD-RENTAL-ORDER", userId: USER, service: "numbers", productSlug: "rent-us-30", productName: "Rental",
      planLabel: "30 days", region: "US", duration: "Rent for 30 days", amount: 1000, status: "active",
      provider: "fleexa", providerRequestId: "legacy-rental", expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    mocks.rentalSms.mockResolvedValueOnce({ messages: [{ code: "111111", body: "First code" }] })
      .mockResolvedValueOnce({ messages: [{ code: "222222", body: "Second code" }] });
    const context = { params: Promise.resolve({ id: order.id }) };
    const url = `https://pryva.test/api/orders/${order.id}/sync`;
    expect(await (await syncRoute.GET(new Request(url), context)).json()).toMatchObject({ otpCode: "111111", status: "active" });
    expect(await (await syncRoute.GET(new Request(url), context)).json()).toMatchObject({ otpCode: "222222", status: "active" });
    const [saved] = await database.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(saved).toMatchObject({ otpCode: "222222", status: "active" });
  });

  it("uses timestamps and never overwrites a newer rental code with a stale poll", async () => {
    const [order] = await database.insert(schema.orders).values({
      reference: "RACE-RENTAL-ORDER", userId: USER, service: "numbers", productSlug: "rent-us-30", productName: "Rental",
      planLabel: "30 days", region: "US", duration: "Rent for 30 days", amount: 1000, status: "active",
      provider: "fleexa", providerRequestId: "legacy-rental", expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    mocks.rentalSms.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
    const context = { params: Promise.resolve({ id: order.id }) };
    const url = `https://pryva.test/api/orders/${order.id}/sync`;
    const oldPoll = syncRoute.GET(new Request(url), context);
    await vi.waitFor(() => expect(mocks.rentalSms).toHaveBeenCalledTimes(1));
    const newPoll = syncRoute.GET(new Request(url), context);
    await vi.waitFor(() => expect(mocks.rentalSms).toHaveBeenCalledTimes(2));
    finishNew({ messages: [{ code: "111111", at: "2026-01-01T00:00:00Z" }, { code: "222222", at: "2026-01-02T00:00:00Z" }] });
    expect(await (await newPoll).json()).toMatchObject({ otpCode: "222222", status: "active" });
    finishOld({ messages: [{ code: "111111", at: "2026-01-01T00:00:00Z" }] });
    expect(await (await oldPoll).json()).toMatchObject({ otpCode: "222222", status: "active", synced: false });
  });

  it("validates scheduled orders, protects mutations, and unpauses fulfillment", async () => {
    const request = (method: string, body: unknown, origin = "https://pryva.test") => new NextRequest("https://pryva.test/api/scheduled-orders", {
      method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    vi.stubEnv("DATABASE_URL", "");
    expect((await scheduledRoute.POST(request("POST", { service: "numbers", productSlug: "vn-ng", frequency: "daily" }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await scheduledRoute.POST(request("POST", { service: "numbers", productSlug: "vn-ng", frequency: "immediate" }))).status).toBe(400);
    expect((await scheduledRoute.POST(request("POST", { service: "esim", productSlug: "vn-ng", frequency: "daily" }))).status).toBe(400);
    const created = await scheduledRoute.POST(request("POST", { service: "numbers", productSlug: "vn-ng", frequency: "daily" }));
    expect(created.status).toBe(200);
    const { id } = await created.json();
    expect((await scheduledRoute.PATCH(request("PATCH", { orderId: id, action: "pause" }, "https://evil.pryva.test"))).status).toBe(403);
    expect((await scheduledRoute.PATCH(request("PATCH", { orderId: id, action: "pause" }))).status).toBe(200);
    vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
    expect((await scheduledRoute.PATCH(request("PATCH", { orderId: id, action: "resume" }))).status).toBe(200);
    expect((await database.select().from(schema.scheduledOrders))[0].status).toBe("active");
  });

  it("does not use supplier promo APIs in preview or for cross-origin requests", async () => {
    const request = (origin: string) => new NextRequest("https://pryva.test/api/accounts/promo", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ slug: "p2:listing", quantity: 1, code: "SAVE" }),
    });
    expect((await promoRoute.POST(request("https://evil.pryva.test"))).status).toBe(403);
    vi.stubEnv("DATABASE_URL", "");
    expect(await (await promoRoute.POST(request("https://pryva.test"))).json()).toMatchObject({ valid: false });
    expect(mocks.getListing).not.toHaveBeenCalled();
    expect(mocks.promo).not.toHaveBeenCalled();
  });
});

describe("the ten-year horizon for closed accounts", () => {
  const OLD = "11111111-1111-4111-8111-111111111111";
  const RECENT = "22222222-2222-4222-8222-222222222222";
  const OPEN = "33333333-3333-4333-8333-333333333333";
  const yearsAgo = (n: number) => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - n);
    return date;
  };

  async function seed() {
    await database.insert(schema.users).values([
      { id: OLD, name: "Deleted account", email: `deleted+${OLD}@deleted.pryva.invalid`, passwordHash: "x", deletedAt: yearsAgo(11) },
      { id: RECENT, name: "Deleted account", email: `deleted+${RECENT}@deleted.pryva.invalid`, passwordHash: "x", deletedAt: yearsAgo(9) },
      { id: OPEN, name: "Customer", email: "open@example.com", passwordHash: "x", walletBalance: 500 },
    ]);
    await database.insert(schema.orders).values({ reference: "ORDER-OLD", userId: OLD, service: "numbers", productSlug: "s", productName: "P", planLabel: "L", region: "NG", duration: "20 min", amount: 1000, provider: "fleexa" });
  }

  it("does nothing unless the sweep is armed", async () => {
    await seed();
    const sweep = await retention.purgeExpiredClosedAccounts({ armed: false });
    expect(sweep).toMatchObject({ armed: false, purged: 0 });
    expect(sweep.due).toBe(1);
    expect(await database.select().from(schema.users)).toHaveLength(4);
    expect(await database.select().from(schema.orders)).toHaveLength(1);
  });

  it("removes the closed account past the horizon and its records with it", async () => {
    await seed();
    const sweep = await retention.purgeExpiredClosedAccounts({ armed: true });
    expect(sweep.purged).toBe(1);

    const remaining = (await database.select().from(schema.users)).map((row) => row.id);
    // The nine-year-old closure and the open customer are untouched — the horizon
    // measures a closure, not an age.
    expect(remaining).not.toContain(OLD);
    expect(remaining).toEqual(expect.arrayContaining([RECENT, OPEN, USER]));
    // Cascade: the order went with the account it belonged to, which is the point
    // of a retention limit.
    expect(await database.select().from(schema.orders)).toHaveLength(0);
  });

  it("holds a closed account whose payout never finished", async () => {
    await seed();
    await database.insert(schema.withdrawals).values({
      userId: OLD, amount: 1000, bankName: "Test Bank", accountNumber: "1234567890",
      accountName: "Test Customer", reference: "WD-old-1", status: "processing",
    });

    const sweep = await retention.purgeExpiredClosedAccounts({ armed: true });
    expect(sweep).toMatchObject({ purged: 0, held: 1 });
    expect(await database.select().from(schema.users)).toHaveLength(4);
  });

  it("counts what is due without deleting anything", async () => {
    await seed();
    expect(await retention.countDueForPurge()).toBe(1);
    expect(await database.select().from(schema.users)).toHaveLength(4);
  });
});
