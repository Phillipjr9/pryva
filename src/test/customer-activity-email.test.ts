import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

// Real PostgreSQL triggers and worker logic; only the external mail provider is
// mocked. PGlite is not a substitute for a concurrent multi-server deployment.
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import { dispatchWalletEmails } from "@/lib/wallet-email-outbox";
import { addAdminMessage, addAssistantMessage, createTicket, setTicketState } from "@/lib/support-tickets";

const USER = "72e85c0a-9d4a-4d38-a5d0-2a839e05d250";
const ADMIN = "c26a9b10-8ac2-4a68-8a9c-cbf653020183";
const EMAIL = "owner@example.test";
let pg: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let fetchMock: ReturnType<typeof vi.fn>;

async function migrate(target: PGlite, through = "0034") {
  const files = (await readdir("migrations")).filter((file) => /^\d{4}_.*\.sql$/.test(file) && file.slice(0, 4) <= through).sort();
  for (const file of files) await target.exec(await readFile(`migrations/${file}`, "utf8"));
}

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg);
  database = drizzle(pg, { schema });
  mocks.db = database;
}, 60_000);

afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <mail@example.test>");
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_placeholder");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryvalogs.com");
  await pg.exec("TRUNCATE TABLE users CASCADE; TRUNCATE TABLE rate_limit_buckets");
  await database.insert(schema.users).values([
    { id: USER, name: "Ada <Owner>", email: EMAIL, passwordHash: "hash", walletBalance: 10000 },
    { id: ADMIN, name: "Support", email: "support@example.test", passwordHash: "hash", walletBalance: 0 },
  ]);
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const jobs = (kind: string) => database.select().from(schema.walletEmailOutbox).where(eq(schema.walletEmailOutbox.eventKind, kind));
const bodyAt = (index: number) => JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit).body)) as {
  to: string[]; subject: string; html: string; text: string;
};

async function order(status: string, provider = "bitcall") {
  const reference = `PRY-${randomUUID().replace(/-/g, "").slice(0, 21).toUpperCase()}`;
  const [item] = await database.insert(schema.orders).values({
    userId: USER, reference, service: provider === "accounts" ? "accounts" : "numbers",
    productSlug: "test-plan", productName: "Test <Plan>", planLabel: "One", region: "NG", duration: "One",
    amount: 2500, status, provider, referenceCode: "PRIVATE-DELIVERY-CREDENTIAL",
  }).returning();
  return item;
}
async function debit(item: typeof schema.orders.$inferSelect) {
  const [entry] = await database.insert(schema.walletTransactions).values({
    userId: USER, orderId: item.id, type: "debit", amount: 2500, balanceAfter: 7500,
    reference: item.reference, description: "Order payment",
  }).returning();
  return entry;
}
async function markHistoricalBuyer() {
  await database.insert(schema.firstPurchaseEmailClaims).values({ userId: USER, source: "historical" });
}

// Simulates the eligibility predicate in the worker that was live before this
// migration. It must not see a new-kind job, even while the new worker holds it.
async function oldWorkerCanClaim() {
  const result = await pg.query<{ count: number }>(`SELECT count(*)::int AS count FROM wallet_email_outbox
    WHERE (status = 'pending' AND available_at <= now())
       OR (status = 'sending' AND (locked_until IS NULL OR locked_until <= now()))`);
  return result.rows[0].count;
}

describe("support reply notifications", () => {
  it("queues only real human replies, without copying the conversation or AI trace", async () => {
    const { ticket } = await createTicket({ userId: USER, body: "PRIVATE CUSTOMER QUESTION" });
    await addAssistantMessage({ ticketId: ticket.id, body: "AI ANSWER", trace: "PRIVATE AI TRACE", status: "open", priority: "normal", category: "other", confidence: 0.5, escalated: false, resolved: false });
    await setTicketState({ ticketId: ticket.id, status: "escalated" });
    expect(await jobs("support_reply")).toHaveLength(0);
    const message = await addAdminMessage({ ticket, adminId: ADMIN, body: "PRIVATE HUMAN RESPONSE", status: "waiting_on_customer" });
    const [job] = await jobs("support_reply");
    expect(job).toMatchObject({ userId: USER, recipient: EMAIL, supportTicketId: ticket.id, supportMessageId: message.id });
    expect(JSON.stringify(job)).not.toMatch(/PRIVATE|AI ANSWER/);
    expect(await oldWorkerCanClaim()).toBe(0);
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    const body = bodyAt(0);
    expect(body.to).toEqual([EMAIL]);
    expect(body.subject).toMatch(/support replied/i);
    expect(body.text).toContain(`https://pryvalogs.com/dashboard/support/${ticket.id}`);
    expect(body.html).toContain("hero-support-reply.jpg");
    expect(body.html).toContain("Ada &lt;Owner&gt;");
    expect(body.text + body.html).not.toMatch(/PRIVATE|AI ANSWER/);
  });

  it("rolls back the alert with a failed reply and does not duplicate one message", async () => {
    const { ticket } = await createTicket({ userId: USER, body: "Help please" });
    const id = randomUUID();
    await expect(database.transaction(async (tx) => {
      await tx.insert(schema.supportMessages).values({ id, ticketId: ticket.id, authorRole: "admin", authorUserId: ADMIN, body: "Temporary" });
      throw new Error("roll back");
    })).rejects.toThrow("roll back");
    expect(await jobs("support_reply")).toHaveLength(0);
    await database.insert(schema.supportMessages).values({ id, ticketId: ticket.id, authorRole: "admin", authorUserId: ADMIN, body: "Committed" });
    await expect(database.insert(schema.supportMessages).values({ id, ticketId: ticket.id, authorRole: "admin", authorUserId: ADMIN, body: "Duplicate" })).rejects.toThrow();
    expect(await jobs("support_reply")).toHaveLength(1);
  });

  it("retries the exact payload and key, invisible to an older worker", async () => {
    const { ticket } = await createTicket({ userId: USER, body: "Help please" });
    await addAdminMessage({ ticket, adminId: ADMIN, body: "Please read this in the dashboard", status: "open" });
    fetchMock.mockImplementationOnce(async () => {
      expect(await oldWorkerCanClaim()).toBe(0);
      throw new Error("ambiguous timeout");
    });
    expect(await dispatchWalletEmails(1)).toMatchObject({ retry: 1 });
    const [pending] = await jobs("support_reply");
    expect(pending.status).toBe("pending");
    expect(pending.availableAt.getFullYear()).toBeGreaterThan(new Date().getFullYear() + 5);
    expect(await oldWorkerCanClaim()).toBe(0);
    await pg.exec("UPDATE wallet_email_outbox SET notification_due_at = now() - interval '1 second'");
    vi.stubEnv("RESEND_FROM_EMAIL", "Changed <other@example.test>");
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["Idempotency-Key"]).toBe((first.headers as Record<string, string>)["Idempotency-Key"]);
  });
});

describe("passkey security notifications", () => {
  it("queues both changes without persisting or mailing key material or labels", async () => {
    const [key] = await database.insert(schema.webauthnCredentials).values({ userId: USER, credentialId: "PRIVATE-CREDENTIAL-ID", publicKey: "PRIVATE-PUBLIC-KEY", label: "PRIVATE-DEVICE-LABEL", counter: 0 }).returning();
    await database.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, key.id));
    expect(await jobs("passkey_added")).toMatchObject([{ recipient: EMAIL, passkeyRowId: key.id }]);
    expect(await jobs("passkey_removed")).toMatchObject([{ recipient: EMAIL, passkeyRowId: key.id }]);
    expect(await oldWorkerCanClaim()).toBe(0);
    expect(await dispatchWalletEmails(4)).toMatchObject({ sent: 2 });
    const bodies = [bodyAt(0), bodyAt(1)];
    expect(bodies.map((body) => body.subject).join(" ")).toMatch(/added/i);
    expect(bodies.map((body) => body.subject).join(" ")).toMatch(/removed/i);
    expect(bodies.map((body) => body.html).join(" ")).toContain("hero-passkey-added.jpg");
    expect(bodies.map((body) => body.html).join(" ")).toContain("hero-passkey-removed.jpg");
    expect(JSON.stringify(bodies)).not.toContain("PRIVATE-");
  });

  it("does not send an alert when credential insertion is rolled back or an account is closed", async () => {
    await expect(database.transaction(async (tx) => {
      await tx.insert(schema.webauthnCredentials).values({ userId: USER, credentialId: "rolled-back", publicKey: "AQID", counter: 0 });
      throw new Error("roll back");
    })).rejects.toThrow("roll back");
    expect(await jobs("passkey_added")).toHaveLength(0);
    const [key] = await database.insert(schema.webauthnCredentials).values({ userId: USER, credentialId: "existing", publicKey: "AQID", counter: 0 }).returning();
    await database.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, USER));
    await database.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, key.id));
    expect(await jobs("passkey_removed")).toHaveLength(0);
    expect(await dispatchWalletEmails(1)).toMatchObject({ review: 1, sent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("purchase receipts", () => {
  it("uses the existing milestone rather than doubling the first purchase", async () => {
    const first = await order("active");
    await debit(first);
    expect(await jobs("first_purchase")).toHaveLength(1);
    expect(await jobs("purchase_recorded")).toHaveLength(0);
  });

  it("sends later paid purchases with their own art and no delivery promises or credentials", async () => {
    await markHistoricalBuyer();
    const item = await order("active");
    const entry = await debit(item);
    expect(await jobs("purchase_recorded")).toMatchObject([{ walletTransactionId: entry.id, recipient: EMAIL }]);
    // Leave the separate legacy wallet debit for another batch.
    await pg.exec("UPDATE wallet_email_outbox SET available_at = now() + interval '1 day' WHERE event_kind = 'wallet'");
    expect(await oldWorkerCanClaim()).toBe(0);
    expect(await dispatchWalletEmails(1)).toMatchObject({ sent: 1 });
    const body = bodyAt(0);
    expect(body.subject).toMatch(/purchase was recorded/i);
    expect(body.text).toContain("₦2,500");
    expect(body.text).toContain(item.reference);
    expect(body.html).toContain("Test &lt;Plan&gt;");
    expect(body.html).toContain("hero-purchase-receipt.jpg");
    expect(body.text).toContain("does not confirm delivery");
    expect(body.text + body.html).not.toContain("PRIVATE-DELIVERY-CREDENTIAL");
  });

  it("waits for a real accepted state, avoids repeats and ignores preview/refunded orders", async () => {
    await markHistoricalBuyer();
    const item = await order("processing");
    await debit(item);
    expect(await jobs("purchase_recorded")).toHaveLength(0);
    await database.update(schema.orders).set({ status: "review" }).where(eq(schema.orders.id, item.id));
    expect(await jobs("purchase_recorded")).toHaveLength(0);
    await database.update(schema.orders).set({ status: "active" }).where(eq(schema.orders.id, item.id));
    await database.update(schema.orders).set({ status: "processing" }).where(eq(schema.orders.id, item.id));
    await database.update(schema.orders).set({ status: "active" }).where(eq(schema.orders.id, item.id));
    expect(await jobs("purchase_recorded")).toHaveLength(1);
    const preview = await order("active", "preview");
    await debit(preview);
    const refunded = await order("processing");
    await debit(refunded);
    await database.update(schema.orders).set({ status: "completed", refundedAt: new Date() }).where(eq(schema.orders.id, refunded.id));
    expect(await jobs("purchase_recorded")).toHaveLength(1);
  });

  it("does not duplicate an existing marketplace delivery notice", async () => {
    await markHistoricalBuyer();
    const item = await order("processing", "accounts");
    await debit(item);
    await database.update(schema.orders).set({ status: "delivered", accounts: "PRIVATE-CREDENTIAL" }).where(eq(schema.orders.id, item.id));
    expect(await jobs("purchase_completed")).toHaveLength(1);
    expect(await jobs("purchase_recorded")).toHaveLength(0);
  });

  it("does not disclose a gift card code in the buyer receipt", async () => {
    await markHistoricalBuyer();
    await database.insert(schema.walletTransactions).values({ userId: USER, type: "debit", amount: 2500, balanceAfter: 7500, reference: "GIFT-PRYVA-PRIVATECODE", description: "Gift card purchase: PRYVA-PRIVATECODE" });
    expect(await jobs("purchase_recorded")).toHaveLength(1);
    await pg.exec("UPDATE wallet_email_outbox SET available_at = now() + interval '1 day' WHERE event_kind = 'wallet'");
    await dispatchWalletEmails(1);
    expect(bodyAt(0).text + bodyAt(0).html).not.toContain("PRIVATECODE");
    expect(bodyAt(0).text).toContain("https://pryvalogs.com/dashboard/gift-cards");
  });

  it("holds financial receipts on test payment keys, but still sends security alerts", async () => {
    await markHistoricalBuyer();
    await debit(await order("active"));
    await database.insert(schema.webauthnCredentials).values({ userId: USER, credentialId: "test-key", publicKey: "AQID", counter: 0 });
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_key");
    await pg.exec("UPDATE wallet_email_outbox SET available_at = now() + interval '1 day' WHERE event_kind = 'wallet'");
    const result = await dispatchWalletEmails(4);
    expect(result).toMatchObject({ sent: 1, review: 1 });
    expect((await jobs("purchase_recorded"))[0]).toMatchObject({ status: "review", lastError: "test_payment_key" });
    expect(bodyAt(0).subject).toMatch(/passkey was added/i);
  });
});

describe("migration and deletion privacy", () => {
  it("does not backfill historical activity and is safe to run again", async () => {
    const old = new PGlite();
    try {
      await migrate(old, "0033");
      await old.exec(`INSERT INTO users (id,name,email,password_hash,wallet_balance) VALUES ('${USER}','Ada','old@example.test','hash',0);
        INSERT INTO webauthn_credentials (user_id,credential_id,public_key,counter) VALUES ('${USER}','old-key','AQID',0);
        INSERT INTO support_tickets (id,user_id,subject) VALUES ('${ADMIN}','${USER}','old ticket');
        INSERT INTO support_messages (ticket_id,author_role,body) VALUES ('${ADMIN}','admin','old reply');
        INSERT INTO users (id,name,email,password_hash,wallet_balance,deleted_at) VALUES ('${ADMIN}','Deleted','deleted@example.test','hash',0,now());
        INSERT INTO webauthn_credentials (user_id,credential_id,public_key,counter) VALUES ('${ADMIN}','closed-key','AQID',0);
        INSERT INTO wallet_transactions (user_id,type,amount,balance_after,reference,description)
          VALUES ('${ADMIN}','credit',1,1,'old-reference','old ledger');
        UPDATE wallet_email_outbox SET payload = 'OLD PRIVATE DELIVERY' WHERE user_id = '${ADMIN}';
        INSERT INTO email_change_requests (user_id,new_email,token_hash,expires_at)
          VALUES ('${ADMIN}','old-private@example.test','old-hash',now() + interval '1 hour');`);
      const migration = await readFile("migrations/0034_customer_activity_emails.sql", "utf8");
      await old.exec(migration);
      await old.exec(migration);
      const result = await old.query<{ count: number }>("SELECT count(*)::int AS count FROM wallet_email_outbox");
      expect(result.rows[0].count).toBe(0);
      // Historical closed-account snapshots, address changes and passkeys are
      // gone; active passkeys and financial evidence are not deleted.
      expect((await old.query<{ count: number }>("SELECT count(*)::int AS count FROM email_change_requests")).rows[0].count).toBe(0);
      expect((await old.query<{ credential_id: string }>("SELECT credential_id FROM webauthn_credentials")).rows).toEqual([{ credential_id: "old-key" }]);
      expect((await old.query<{ count: number }>("SELECT count(*)::int AS count FROM wallet_transactions")).rows[0].count).toBe(1);
      await old.exec(`INSERT INTO support_messages (ticket_id,author_role,body) VALUES ('${ADMIN}','admin','new reply')`);
      expect((await old.query<{ count: number }>("SELECT count(*)::int AS count FROM wallet_email_outbox WHERE event_kind = 'support_reply'")).rows[0].count).toBe(1);
    } finally { await old.close(); }
  }, 60_000);

  it("never queues an outbox job for an already closed account", async () => {
    await database.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, USER));
    await database.insert(schema.walletTransactions).values({ userId: USER, type: "credit", amount: 1, balanceAfter: 1, reference: "LATE", description: "Late credit" });
    expect(await database.select().from(schema.walletEmailOutbox)).toHaveLength(0);
  });

  it("rejects late security records from older app instances after closure", async () => {
    await database.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, USER));
    await expect(database.insert(schema.webauthnCredentials).values({
      userId: USER, credentialId: "late-key", publicKey: "AQID", counter: 0,
    })).rejects.toThrow();
    await expect(database.insert(schema.emailChangeRequests).values({
      userId: USER, newEmail: "private@example.test", tokenHash: "late-hash", expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toThrow();
    expect(await database.select().from(schema.webauthnCredentials)).toHaveLength(0);
    expect(await database.select().from(schema.emailChangeRequests)).toHaveLength(0);
    expect(await jobs("passkey_added")).toHaveLength(0);

    // Rejecting rather than silently dropping the first insert also leaves the
    // globally unique credential free to register to an active account.
    await database.insert(schema.webauthnCredentials).values({
      userId: ADMIN, credentialId: "late-key", publicKey: "AQID", counter: 0,
    });
    expect(await database.select().from(schema.webauthnCredentials)).toHaveLength(1);
  });

  it("rejects moving a security record to a closed owner", async () => {
    const [credential] = await database.insert(schema.webauthnCredentials).values({
      userId: ADMIN, credentialId: "owned-key", publicKey: "AQID", counter: 0,
    }).returning();
    const [request] = await database.insert(schema.emailChangeRequests).values({
      userId: ADMIN, newEmail: "new@example.test", tokenHash: "active-hash", expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    await database.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, USER));
    await expect(database.update(schema.webauthnCredentials).set({ userId: USER })
      .where(eq(schema.webauthnCredentials.id, credential.id))).rejects.toThrow();
    await expect(database.update(schema.emailChangeRequests).set({ userId: USER })
      .where(eq(schema.emailChangeRequests.id, request.id))).rejects.toThrow();
    expect((await database.select().from(schema.webauthnCredentials))[0].userId).toBe(ADMIN);
    expect((await database.select().from(schema.emailChangeRequests))[0].userId).toBe(ADMIN);
  });
});

describe("individual 3D artwork", () => {
  it("ships ten different, nonempty image files for the audited templates", async () => {
    const names = ["support-reply", "passkey-added", "passkey-removed", "purchase-receipt", "two-factor-on", "two-factor-off", "email-confirm", "email-changed", "esim-delivery", "number-code"];
    const images = await Promise.all(names.map((name) => readFile(`public/images/email/hero-${name}.jpg`)));
    expect(images.every((image) => image.length > 10_000 && image.subarray(0, 2).toString("hex") === "ffd8")).toBe(true);
    expect(new Set(images.map((image) => createHash("sha256").update(image).digest("hex"))).size).toBe(names.length);
  });
});
