import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeEsimDeliveryEmail } from "@/lib/esim-email-template";
import { esimQrAttachment } from "@/lib/esim-qr";

/**
 * The eSIM handover email.
 *
 * A QR and an activation string are the product; leaving them only behind a
 * login means a closed tab is a support ticket. These pin that the material
 * reaches the inbox, that the QR is a real PNG rather than a link that can rot,
 * and that one order produces exactly one email however it is delivered.
 */
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import { dispatchWalletEmails } from "@/lib/wallet-email-outbox";

const USER = "8f2a4c31-5d6b-4e79-9a10-3c2d1e4f5a60";
const ACTIVATION = "LPA:1$rsp.truphone.com$ABC123-DEF456-GHI789";

function delivery(overrides: Partial<Parameters<typeof makeEsimDeliveryEmail>[0]> = {}) {
  return makeEsimDeliveryEmail({
    recipient: "buyer@example.test",
    sender: "Pryva <mail@pryva.test>",
    orderReference: "SIM-ABC123",
    productName: "Nigeria 1GB · 7 days",
    planLabel: "1GB · 7 days",
    region: "Nigeria",
    duration: "7 days",
    activationCode: ACTIVATION,
    installUrl: "https://esim.example.test/install/abc",
    iccid: "8988212345678901234",
    orderUrl: "https://pryva.test/dashboard/orders/order-1",
    attachment: { filename: "pryva-esim-qr.png", content: "iVBORw0KGgo=", content_id: "esim-qr" },
    ...overrides,
  });
}

describe("the eSIM delivery email itself", () => {
  it("carries the QR, the code and the install steps", () => {
    const email = delivery();

    expect(email.subject).toContain("eSIM is ready");
    expect(email.text).toContain(ACTIVATION);
    expect(email.text).toContain("Add eSIM");
    expect(email.text).toContain("8988212345678901234");
    // The QR renders inline from the attachment, and is still downloadable.
    expect(email.html).toContain("cid:esim-qr");
    expect(email.attachments).toEqual([
      { filename: "pryva-esim-qr.png", content: "iVBORw0KGgo=", content_id: "esim-qr" },
    ]);
    // The design is dimensional, but still degradable: no scripts, no remote images.
    expect(email.html).not.toContain("<script");
    expect(email.html).toContain("linear-gradient");
  });

  it("stays inside what the outbox accepts, and escapes what it is given", () => {
    const email = delivery({ productName: '<script>alert("x")</script> eSIM', planLabel: "1GB & 7 days" });

    expect(email.html.length).toBeLessThan(20_000);
    expect(email.text.length).toBeLessThan(10_000);
    expect(email.html).not.toContain('<script>alert("x")</script>');
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(email.html).toContain("1GB &amp; 7 days");
  });

  it("falls back to written instructions when there is no QR and no install link", () => {
    const email = delivery({ attachment: null, installUrl: null });
    expect(email.attachments).toBeUndefined();
    expect(email.html).not.toContain("cid:esim-qr");
    expect(email.html).toContain("Enter details manually");
    expect(email.text).toContain(ACTIVATION);
  });

  it("refuses a payload it cannot trust", () => {
    expect(() => delivery({ recipient: "not-an-email" })).toThrow();
    expect(() => delivery({ activationCode: "   " })).toThrow();
    expect(() => delivery({ sender: "Pryva\r\nBcc: evil@example.test" })).toThrow();
    // A non-https install link is not a link we put in a customer's inbox.
    expect(delivery({ installUrl: "javascript:alert(1)" }).html).not.toContain("javascript:");
  });

  it("draws a real PNG for the activation string", async () => {
    const attachment = await esimQrAttachment(ACTIVATION);
    expect(attachment?.content_id).toBe("esim-qr");
    expect(attachment?.filename).toBe("pryva-esim-qr.png");
    // PNG magic bytes, base64-encoded.
    expect(Buffer.from(attachment!.content, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    expect(await esimQrAttachment("")).toBeNull();
    expect(await esimQrAttachment("x".repeat(2_000))).toBeNull();
  });
});

describe("queueing the email when an eSIM is handed over", () => {
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
      "0028_esim_delivery_email.sql",
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
    userId: USER, service: "esim", productSlug: "esim-ng-1", productName: "Nigeria 1GB",
    planLabel: "1GB · 7 days", region: "Nigeria", duration: "7 days", amount: 5000,
    status: "active", provider: "bitcall",
  } as const;

  it("queues exactly one delivery for an order that arrives already provisioned", async () => {
    await database.insert(schema.orders).values({
      ...base, reference: "SIM-ARRIVED", providerRequestId: "ord-1",
      esimIccid: "8988212345678901234", esimActivationCode: ACTIVATION,
    });

    const jobs = await database.select().from(schema.walletEmailOutbox);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ eventKind: "esim_delivery", recipient: "buyer@example.test", status: "pending" });
  });

  it("queues it when a provisioning order finishes later, and only once", async () => {
    const [order] = await database.insert(schema.orders).values({
      ...base, reference: "SIM-LATER", status: "processing", providerRequestId: "ord-2",
    }).returning();
    expect(await database.select().from(schema.walletEmailOutbox)).toHaveLength(0);

    await database.update(schema.orders)
      .set({ status: "active", esimIccid: "8988212345678901234", esimActivationCode: ACTIVATION })
      .where(eq(schema.orders.id, order.id));
    // A later metadata write must not queue a second email.
    await database.update(schema.orders).set({ planLabel: "1GB · 7 days" }).where(eq(schema.orders.id, order.id));

    const jobs = await database.select().from(schema.walletEmailOutbox);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ eventKind: "esim_delivery", orderId: order.id });
  });

  it("leaves number orders alone", async () => {
    await database.insert(schema.orders).values({
      ...base, service: "numbers", productSlug: "vn-ng", reference: "NUM-1", status: "delivered",
      provider: "fleexa", esimActivationCode: null,
    });
    expect(await database.select().from(schema.walletEmailOutbox)).toHaveLength(0);
  });

  it("sends the profile with its QR attachment, and records the send", async () => {
    await database.insert(schema.orders).values({
      ...base, reference: "SIM-SENT", providerRequestId: "ord-3",
      esimIccid: "8988212345678901234", esimActivationCode: ACTIVATION,
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-esim" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchWalletEmails(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      subject: string; html: string; text: string;
      attachments: Array<{ filename: string; content: string; content_id?: string }>;
    };
    expect(url).toBe("https://api.resend.com/emails");
    expect(body.subject).toContain("eSIM is ready");
    expect(body.html).toContain("cid:esim-qr");
    expect(body.text).toContain(ACTIVATION);
    expect(body.attachments).toHaveLength(1);
    expect(Buffer.from(body.attachments[0].content, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");

    const [job] = await database.select().from(schema.walletEmailOutbox);
    expect(job).toMatchObject({ status: "sent", eventKind: "esim_delivery", providerMessageId: "msg-esim" });
  });
});
