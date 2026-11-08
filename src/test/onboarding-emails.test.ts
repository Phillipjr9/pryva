import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { customerWelcomeEmail, emailVerifiedEmail, emailVerificationEmail, passwordResetEmail } from "@/lib/email/email-templates";

/**
 * The receipt for the click, and the welcome.
 *
 * Both were missing: confirming an address ended in silence, and `welcomeEmail()`
 * had no caller in the entire codebase. Nothing failed, nothing logged, and the
 * only symptom was that a new customer heard from Pryva exactly once.
 *
 * Two properties matter more than the copy, and these tests are about them:
 *
 *   • **Once, ever.** Both emails are triggered by the same milestone, and two
 *     routes can reach that milestone at the same moment. The unique index on
 *     `(user_id, kind)` is what makes a second copy impossible rather than
 *     unlikely, so it is exercised directly by racing two callers.
 *   • **Never at the cost of the verification.** The database work is committed
 *     before any mail is attempted, and a provider failure must leave the account
 *     verified with the refusal recorded, not throw.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));
vi.mock("server-only", () => ({}));

import { sendOnboardingEmails, backfillOnboardingEmails } from "@/lib/email/onboarding-emails";
import { emailQueueStatus } from "@/lib/email/email-delivery-events";

const USER = "b1a6f0e2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
let pg: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  for (const file of [
    "0000_base_schema.sql", "0001_google_subject.sql", "0002_shared_rate_limits.sql",
    "0003_withdrawal_idempotency.sql", "0004_paystack_transfer_reference.sql",
    "0005_wallet_email_outbox.sql", "0006_order_idempotency.sql", "0007_order_reconciliation_note.sql",
    "0008_order_provider_cost.sql", "0009_password_reset_tokens.sql", "0010_order_provider_no_default.sql",
    "0011_email_verification.sql", "0012_topup_payer_name.sql", "0013_disposable_inboxes.sql",
    "0014_admin_audit_log.sql", "0015_two_factor.sql", "0016_product_reviews.sql",
    "0017_login_lockout.sql", "0018_reconciliation_runs.sql", "0019_support_tickets.sql",
    "0020_webauthn.sql", "0021_referrals.sql", "0022_fraud.sql", "0023_boost_orders.sql",
    "0024_account_deletions.sql", "0025_account_deletion_forfeiture.sql", "0026_webhook_events.sql",
    "0027_esim_credentials.sql", "0028_esim_delivery_email.sql", "0029_notification_gaps.sql",
    "0030_payout_name_approvals.sql", "0031_email_delivery_events.sql", "0032_welcome_verified_emails.sql", "0033_account_activity_emails.sql", "0034_customer_activity_emails.sql", "0035_code_received_at.sql",
  ]) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  mocks.db = database;
}, 60_000);

afterAll(async () => { await pg?.close(); });

let sent: { subject: string; to: string }[] = [];
let respond: () => Response;

function accepted(id = "resend-message-id") {
  return new Response(JSON.stringify({ id }), { status: 200 });
}

beforeEach(async () => {
  sent = [];
  respond = () => accepted();
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <noreply@pryva.test>");
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { subject: string; to: string; html: string };
    sent.push({ subject: body.subject, to: body.to });
    return respond();
  }));
  await pg.exec('TRUNCATE TABLE "onboarding_email_log", "users" CASCADE');
  await database.insert(schema.users).values({
    id: USER,
    name: "Ada",
    email: "ada@example.test",
    passwordHash: "hash",
    emailVerifiedAt: new Date("2026-11-04T09:00:00Z"),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendOnboardingEmails", () => {
  it("sends the receipt before the welcome, once each", async () => {
    const outcome = await sendOnboardingEmails(USER);
    expect(outcome).toEqual({ verified: "accepted", welcome: "accepted" });
    expect(sent.map((mail) => mail.subject)).toEqual([
      "Your Pryva email is confirmed",
      "Welcome to Pryva — your account is ready",
    ]);
    // Both go to the address on the account, never to one supplied by a caller.
    expect(new Set(sent.map((mail) => mail.to))).toEqual(new Set(["ada@example.test"]));
  });

  it("records what the provider said, and joins it to the delivery events", async () => {
    await sendOnboardingEmails(USER);
    const rows = await database.select().from(schema.onboardingEmailLog);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("accepted");
      expect(row.providerMessageId).toBe("resend-message-id");
      expect(row.sentAt).toBeInstanceOf(Date);
    }
  });

  it("never sends a second copy, however many times it is called", async () => {
    await sendOnboardingEmails(USER);
    const again = await sendOnboardingEmails(USER);
    expect(again).toEqual({ verified: "duplicate", welcome: "duplicate" });
    expect(sent).toHaveLength(2);
  });

  it("cannot be raced into a duplicate by two callers arriving together", async () => {
    // The confirm route and the resend route's already-verified branch can both
    // reach this moment. The unique index decides who sends; the loser must be a
    // no-op, not a second email in the customer's inbox.
    await Promise.all([sendOnboardingEmails(USER), sendOnboardingEmails(USER)]);
    expect(sent).toHaveLength(2);
    const rows = await database.select().from(schema.onboardingEmailLog);
    expect(rows).toHaveLength(2);
  });

  it("does nothing for an account that has not confirmed its address", async () => {
    await pg.exec(`UPDATE users SET email_verified_at = NULL WHERE id = '${USER}'`);
    expect(await sendOnboardingEmails(USER)).toEqual({ verified: "ineligible", welcome: "ineligible" });
    expect(sent).toHaveLength(0);
  });

  it("does nothing for a closed account", async () => {
    await pg.exec(`UPDATE users SET deleted_at = now() WHERE id = '${USER}'`);
    expect(await sendOnboardingEmails(USER)).toEqual({ verified: "ineligible", welcome: "ineligible" });
    expect(sent).toHaveLength(0);
  });

  it("does not claim a send when mail is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const outcome = await sendOnboardingEmails(USER);
    expect(outcome).toEqual({ verified: "skipped", welcome: "skipped" });
    expect(sent).toHaveLength(0);
    const [row] = await database.select().from(schema.onboardingEmailLog);
    expect(row.status).toBe("skipped");
    expect(row.detail).toContain("not configured");
  });

  it("can retry skipped messages once mail configuration is fixed", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await sendOnboardingEmails(USER);
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const result = await sendOnboardingEmails(USER);
    expect(result).toEqual({ verified: "accepted", welcome: "accepted" });
    expect(sent).toHaveLength(2);
  });

  it("records a refusal instead of throwing it, so verification still stands", async () => {
    respond = () => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 });
    await expect(sendOnboardingEmails(USER)).resolves.toEqual({
      verified: "refused",
      welcome: "refused",
    });
    const rows = await database.select().from(schema.onboardingEmailLog);
    expect(rows.map((row) => row.status)).toEqual(["refused", "refused"]);
    // The operator can see what happened without a customer complaint.
    expect(rows[0].detail).toContain("403");
    expect(rows[0].sentAt).toBeNull();
    const health = await emailQueueStatus();
    expect(health.onboarding).toEqual(expect.arrayContaining([
      { status: "refused", kind: "verified", total: 1 },
      { status: "refused", kind: "welcome", total: 1 },
    ]));
    expect(JSON.stringify(health)).not.toContain("ada@example.test");
  });

  it("keeps going when the provider cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const outcome = await sendOnboardingEmails(USER);
    expect(outcome).toEqual({ verified: "review", welcome: "review" });
    const rows = await database.select().from(schema.onboardingEmailLog);
    expect(rows).toHaveLength(2);
    expect(rows[0].detail).toContain("could not be reached");
    await sendOnboardingEmails(USER);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("retries definite provider refusals without manually deleting the log", async () => {
    respond = () => new Response("{}", { status: 403 });
    await sendOnboardingEmails(USER);
    respond = () => accepted();
    sent = [];
    await Promise.all([sendOnboardingEmails(USER), sendOnboardingEmails(USER)]);
    expect(sent).toHaveLength(2);
    expect((await database.select().from(schema.onboardingEmailLog)).map((row) => row.status)).toEqual(["accepted", "accepted"]);
  });

  it("does not automatically retry an ambiguous provider failure", async () => {
    respond = () => new Response("{}", { status: 500 });
    await sendOnboardingEmails(USER);
    respond = () => accepted();
    sent = [];
    await sendOnboardingEmails(USER);
    expect(sent).toHaveLength(0);
    expect((await database.select().from(schema.onboardingEmailLog)).map((row) => row.status)).toEqual(["review", "review"]);
  });
});

describe("backfillOnboardingEmails", () => {
  it("finishes the sequence for accounts that verified before it existed", async () => {
    // The production shape of the problem: verified, no welcome, no way to
    // re-verify. This is what the nightly job runs.
    await pg.exec(`UPDATE users SET created_at = now() - interval '2 days'`);
    const result = await backfillOnboardingEmails({ limit: 10, sinceDays: 30 });
    expect(result).toEqual({ considered: 1, sent: 1 });
    expect(sent).toHaveLength(2);
    // And a second run finds nothing left to do.
    expect(await backfillOnboardingEmails({ limit: 10, sinceDays: 30 })).toEqual({
      considered: 0,
      sent: 0,
    });
  });

  it("finds a refused receipt even when the welcome was accepted", async () => {
    let calls = 0;
    respond = () => ++calls === 1 ? new Response("{}", { status: 403 }) : accepted();
    await sendOnboardingEmails(USER);
    sent = [];
    respond = () => accepted();
    expect(await backfillOnboardingEmails()).toEqual({ considered: 1, sent: 1 });
    expect(sent.map((mail) => mail.subject)).toEqual(["Your Pryva email is confirmed"]);
  });

  it("does not repeatedly select accounts waiting on ambiguous sends", async () => {
    respond = () => new Response("{}", { status: 500 });
    await sendOnboardingEmails(USER);
    expect(await backfillOnboardingEmails()).toEqual({ considered: 0, sent: 0 });
  });

  it("will not welcome somebody who signed up long ago", async () => {
    // A "welcome aboard, get started" eight months late reads as phishing.
    await pg.exec(`UPDATE users SET created_at = now() - interval '200 days'`);
    expect(await backfillOnboardingEmails({ limit: 10, sinceDays: 30 })).toEqual({
      considered: 0,
      sent: 0,
    });
    expect(sent).toHaveLength(0);
  });
});

describe("the two templates", () => {
  it("carries the same branded card as every other customer email", () => {
    for (const template of [
      emailVerifiedEmail("Ada", "ada@example.test"),
      customerWelcomeEmail("Ada"),
    ]) {
      expect(template.html).toContain("/images/brand/pryva-mark.png");
      expect(template.html).toContain("/images/email/hero-");
      expect(template.html).toContain("linear-gradient");
      expect(template.html).toContain("border-radius:18px");
      expect(template.html).toContain("DM Sans");
      expect(template.html.length).toBeGreaterThan(2_000);
      expect(template.text.length).toBeGreaterThan(100);
      expect(template.preheader?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("uses the dedicated 3D artwork, not a reused hero", () => {
    // The receipt has its own seal-and-pedestal render so it does not read as a
    // resend of the confirmation email it is confirming.
    expect(emailVerifiedEmail("Ada", "ada@example.test").html).toContain(
      "/images/email/hero-verified.jpg",
    );
    expect(customerWelcomeEmail("Ada").html).toContain("/images/email/hero-welcome.jpg");
  });

  it("escapes a name that could otherwise break the layout", () => {
    const html = customerWelcomeEmail('<script>alert("x")</script>').html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes account names and links in verification and reset HTML", () => {
    const name = `<img src=x onerror=alert(1)>`;
    const link = `https://pryvalogs.com/reset?token=a&next="x"`;
    for (const template of [emailVerificationEmail(name, link), passwordResetEmail(name, link)]) {
      expect(template.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(template.html).not.toContain(name);
      expect(template.html).toContain("token=a&amp;next=&quot;x&quot;");
      expect(template.text).toContain(link);
    }
  });

  it("does not promise instant fulfillment, automatic refunds or guaranteed delivery", () => {
    for (const template of [customerWelcomeEmail("Ada"), emailVerifiedEmail("Ada", "ada@example.test")]) {
      expect(template.html + template.text).not.toMatch(/delivered instantly|the moment you buy|every purchase emails|refunded automatically|every security notice now reach/i);
    }
  });

  it("reports the confirmed address in the receipt", () => {
    const template = emailVerifiedEmail("Ada", "ada@example.test", new Date("2026-11-04T09:00:00Z"));
    expect(template.html).toContain("ada@example.test");
    expect(template.text).toContain("ada@example.test");
  });
});
