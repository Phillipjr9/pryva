import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeBoostCompleteEmail } from "@/lib/boost-email-template";

/**
 * "Your boost finished."
 *
 * A boost runs for hours or days, so the customer is by definition not watching
 * when it lands. These pin the two halves of the fix: the row is queued by the
 * database itself whenever a boost reaches `delivered` (whichever code path put
 * it there), and the message says only what the customer bought.
 */
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import { dispatchWalletEmails } from "@/lib/wallet-email-outbox";

const USER = "3c9b7d52-1f84-4a6e-8c02-5b7e9d1f4a83";

function completion(overrides: Partial<Parameters<typeof makeBoostCompleteEmail>[0]> = {}) {
  return makeBoostCompleteEmail({
    recipient: "buyer@example.test",
    sender: "Pryva <mail@pryva.test>",
    orderReference: "BST-7K2M9Q",
    productName: "Instagram followers",
    planLabel: "1,000 followers",
    quantity: 1000,
    targetLink: "https://instagram.com/pryva.test",
    orderUrl: "https://pryva.test/dashboard/orders/order-1",
    ...overrides,
  });
}

describe("the boost completion email itself", () => {
  it("says what was delivered, where, and against which reference", () => {
    const email = completion();

    expect(email.subject).toContain("BST-7K2M9Q");
    expect(email.text).toContain("1,000 × 1,000 followers");
    expect(email.text).toContain("https://instagram.com/pryva.test");
    expect(email.text).toContain("Your boost has finished");
    expect(email.html).toContain("Delivered");
  });

  it("never names the panel, the supplier or its order id", () => {
    const email = completion();
    const everything = `${email.subject} ${email.text} ${email.html}`.toLowerCase();

    for (const word of [/smm/, /panel/, /supplier/, /provider/, /reseller/, /upstream/]) {
      expect(everything).not.toMatch(word);
    }
  });

  it("prints the customer's link and escapes it, without making it clickable", () => {
    const email = completion({ targetLink: "https://example.test/a?b=1&c=<script>" });

    expect(email.html).toContain("b=1&amp;c=&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    // The only anchor is our own order page: a copied link in a transactional
    // email is what makes a legitimate message look like phishing.
    expect(email.html.match(/<a /g)).toHaveLength(1);
    expect(email.html).toContain("https://pryva.test/dashboard/orders/order-1");
  });

  it("stays inside what the outbox accepts", () => {
    const email = completion();

    expect(email.html.length).toBeLessThan(20_000);
    expect(email.text.length).toBeLessThan(10_000);
    expect(email.html).not.toContain("<script");
    expect(email.html).toContain("linear-gradient");
  });

  it("survives a legacy row with no quantity and no target", () => {
    const email = completion({ quantity: null, targetLink: null });

    expect(email.text).not.toContain("null");
    expect(email.text).toContain("1,000 followers");
    expect(email.text).toContain("BST-7K2M9Q");
  });

  it("refuses a payload it cannot trust", () => {
    expect(() => completion({ recipient: "not-an-email" })).toThrow();
    expect(() => completion({ sender: "Pryva\r\nBcc: evil@example.test" })).toThrow();
    expect(() => completion({ quantity: 0 })).toThrow();
    expect(() => completion({ quantity: -5 })).toThrow();
  });
});

describe("queueing the email when a boost is delivered", () => {
  let pg: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pg = new PGlite();
    for (const file of [
      "0000_base_schema.sql", "0001_google_subject.sql", "0002_shared_rate_limits.sql", "0003_withdrawal_idempotency.sql",
      "0004_paystack_transfer_reference.sql", "0005_wallet_email_outbox.sql", "0006_order_idempotency.sql",
      "0007_order_reconciliation_note.sql", "0008_order_provider_cost.sql", "0009_password_reset_tokens.sql",
      "0010_order_provider_no_default.sql", "0011_email_verification.sql", "0012_topup_payer_name.sql",
      "0013_disposable_inboxes.sql", "0014_admin_audit_log.sql", "0015_two_factor.sql", "0016_product_reviews.sql",
      "0017_login_lockout.sql", "0018_reconciliation_runs.sql", "0019_support_tickets.sql", "0020_webauthn.sql",
      "0021_referrals.sql", "0022_fraud.sql", "0023_boost_orders.sql", "0024_account_deletions.sql",
      "0025_account_deletion_forfeiture.sql", "0026_webhook_events.sql", "0027_esim_credentials.sql",
      "0028_esim_delivery_email.sql", "0029_notification_gaps.sql", "0030_payout_name_approvals.sql",
      "0031_boost_complete_email.sql",
    ]) {
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
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pryva.test");
    await pg.exec('TRUNCATE TABLE "users" CASCADE; TRUNCATE TABLE rate_limit_buckets');
    await database.insert(schema.users).values({ id: USER, name: "Buyer", email: "buyer@example.test", passwordHash: "hash", walletBalance: 20000 });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const base = {
    userId: USER, service: "social", productSlug: "ig-followers", productName: "Instagram followers",
    planLabel: "1,000 followers", region: "Not country-specific", duration: "Until delivered",
    amount: 4500, status: "processing", provider: "smm",
    targetLink: "https://instagram.com/pryva.test", quantity: 1000,
  } as const;

  async function jobs() {
    return database.select().from(schema.walletEmailOutbox);
  }

  it("queues one email the moment the sweep marks a boost delivered", async () => {
    await database.insert(schema.orders).values({ ...base, reference: "BST-ONE", providerRequestId: "panel-77" });
    expect(await jobs()).toHaveLength(0);

    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.reference, "BST-ONE"));

    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ eventKind: "boost_complete", recipient: "buyer@example.test", status: "pending" });
  });

  it("is not sent twice, however many times the status is rewritten", async () => {
    await database.insert(schema.orders).values({ ...base, reference: "BST-TWICE", providerRequestId: "panel-78" });

    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.reference, "BST-TWICE"));
    await database.update(schema.orders).set({ status: "review" }).where(eq(schema.orders.reference, "BST-TWICE"));
    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.reference, "BST-TWICE"));
    // A status-only rewrite of the same value must not queue anything either.
    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.reference, "BST-TWICE"));

    expect(await jobs()).toHaveLength(1);
  });

  it("stays quiet for every other service and for an undelivered boost", async () => {
    await database.insert(schema.orders).values({
      ...base, reference: "NUM-ONE", provider: "fleexa", service: "numbers", status: "delivered",
      productName: "Verification number", planLabel: "One code", quantity: null, targetLink: null,
    });
    await database.insert(schema.orders).values({ ...base, reference: "BST-OPEN", providerRequestId: "panel-79" });
    await database.update(schema.orders).set({ status: "review" }).where(eq(schema.orders.reference, "BST-OPEN"));

    expect(await jobs()).toHaveLength(0);
  });

  it("sends it, and records that it was sent", async () => {
    await database.insert(schema.orders).values({ ...base, reference: "BST-SENT", providerRequestId: "panel-80" });
    await database.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.reference, "BST-SENT"));

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-boost" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchWalletEmails(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { subject: string; text: string; html: string };
    expect(url).toBe("https://api.resend.com/emails");
    expect(body.subject).toContain("BST-SENT");
    expect(body.text).toContain("1,000 × 1,000 followers");
    // The panel's own order id is an internal handle and never leaves the app.
    expect(`${body.subject}${body.text}${body.html}`).not.toContain("panel-80");

    const [job] = await jobs();
    expect(job).toMatchObject({ status: "sent", eventKind: "boost_complete", providerMessageId: "msg-boost" });
  });
});
