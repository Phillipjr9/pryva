import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { paymentTopups, scheduledOrders, supportMessages, supportTickets, users } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  verifyPayment: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/lib/paystack", () => ({
  isPaystackConfigured: () => true,
  verifyPayment: mocks.verifyPayment,
}));

const USER = "9c1f7d4e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
const OTHER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let tickets: typeof import("@/lib/support-tickets");
let assistant: typeof import("@/lib/ai-support");
let actions: typeof import("@/lib/ai-support/actions");

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  tickets = await import("@/lib/support-tickets");
  assistant = await import("@/lib/ai-support");
  actions = await import("@/lib/ai-support/actions");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await database.execute(
    sql`TRUNCATE TABLE support_messages, support_tickets, wallet_transactions, payment_topups, scheduled_orders, two_factor_challenges, user_two_factor, users CASCADE`,
  );
  await database.insert(users).values([
    { id: USER, name: "Ada", email: "ada@example.com", passwordHash: "x", walletBalance: 0, emailVerifiedAt: new Date() },
    { id: OTHER, name: "Bola", email: "bola@example.com", passwordHash: "x", walletBalance: 0 },
  ]);
});

describe("the ticket itself", () => {
  it("opens a thread with the customer's own words and a subject from them", async () => {
    const { ticket, message } = await tickets.createTicket({
      userId: USER,
      body: "I paid 5,000 naira an hour ago and my wallet is still empty. Please help.",
    });

    expect(ticket.status).toBe("open");
    expect(ticket.userId).toBe(USER);
    expect(ticket.subject).toBe("I paid 5,000 naira an hour ago and my wallet is still empty.");
    expect(message.authorRole).toBe("customer");
    expect(message.authorUserId).toBe(USER);
  });

  it("keeps a subject short enough for a queue", () => {
    const subject = tickets.subjectFromBody("x".repeat(400));
    expect(subject.length).toBeLessThanOrEqual(160);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("never shows one customer another customer's thread", async () => {
    const { ticket } = await tickets.createTicket({ userId: USER, body: "my number is not working" });
    expect(await tickets.getTicketForUser(OTHER, ticket.id)).toBeNull();
    expect(await tickets.getTicketForUser(USER, ticket.id)).not.toBeNull();
  });

  it("reopens a resolved thread instead of starting a second one", async () => {
    const { ticket } = await tickets.createTicket({ userId: USER, body: "first question" });
    await tickets.setTicketState({ ticketId: ticket.id, status: "resolved" });

    const resolved = await tickets.getTicketForUser(USER, ticket.id);
    await tickets.addCustomerMessage({ ticket: resolved!, userId: USER, body: "actually it happened again" });

    const reopened = await tickets.getTicket(ticket.id);
    expect(reopened?.status).toBe("open");
    expect(reopened?.resolvedAt).toBeNull();
    expect((await tickets.getThread(ticket.id)).length).toBe(2);
  });

  it("records who finished a ticket", async () => {
    const { ticket } = await tickets.createTicket({ userId: USER, body: "hello" });
    await tickets.addAdminMessage({ ticket, adminId: OTHER, body: "Fixed it for you.", status: "resolved" });

    const [after] = await database.select().from(supportTickets).where(eq(supportTickets.id, ticket.id));
    expect(after.status).toBe("resolved");
    expect(after.handledBy).toBe("admin");
    expect(after.resolvedAt).toBeTruthy();
    expect(after.assignedAdminId).toBe(OTHER);
  });

  it("counts the queue by what a person has to do", async () => {
    const a = await tickets.createTicket({ userId: USER, body: "one" });
    const b = await tickets.createTicket({ userId: USER, body: "two" });
    const c = await tickets.createTicket({ userId: USER, body: "three" });
    await tickets.escalateTicket(b.ticket.id);
    await tickets.setTicketState({ ticketId: c.ticket.id, status: "waiting_on_customer" });

    const summary = await tickets.ticketQueueSummary();
    expect(summary.open).toBe(1);
    expect(summary.escalated).toBe(1);
    expect(summary.waiting).toBe(1);
    expect(a.ticket.id).toBeTruthy();
  });
});

describe("the assistant against a real account", () => {
  it("finds a pending deposit, asks the provider, credits it once, and stores its reasoning", async () => {
    await database.insert(paymentTopups).values({ reference: "TOP-real-1", userId: USER, amount: 5000, status: "pending" });
    mocks.verifyPayment.mockResolvedValue({
      status: true,
      data: {
        status: "success",
        reference: "TOP-real-1",
        currency: "NGN",
        amount: 500000,
        requested_amount: 500000,
        customer: { email: "ada@example.com" },
      },
    });

    const { ticket } = await tickets.createTicket({ userId: USER, body: "I paid 5000 and my wallet is still empty" });
    const result = await assistant.respondToTicket({
      ticketId: ticket.id,
      userId: USER,
      userEmail: "ada@example.com",
      userName: "Ada",
      message: "I paid 5000 and my wallet is still empty",
    });

    expect(result.outcome).toBe("fixed");
    expect(result.actions[0]).toMatchObject({ remedy: "recheck_topup", status: "succeeded" });

    const [account] = await database.select().from(users).where(eq(users.id, USER));
    expect(account.walletBalance).toBe(5000);

    const [stored] = await database.select().from(supportTickets).where(eq(supportTickets.id, ticket.id));
    expect(stored.status).toBe("resolved");
    expect(stored.handledBy).toBe("assistant");
    expect(stored.assistantConfidence).toBeGreaterThanOrEqual(72);

    const thread = await database.select().from(supportMessages).where(eq(supportMessages.ticketId, ticket.id));
    const reply = thread.find((message) => message.authorRole === "assistant");
    expect(reply?.body).toContain("₦5,000");
    // The operator's copy of the reasoning is stored beside the reply.
    const trace = JSON.parse(reply!.trace ?? "{}");
    expect(trace.playbook).toBe("deposit-missing");
    expect(trace.steps.map((step: { kind: string }) => step.kind)).toContain("verify");

    // Running it again credits nothing: the deposit is no longer pending, and the
    // same reference can never be credited twice.
    const second = await assistant.respondToTicket({
      ticketId: ticket.id,
      userId: USER,
      userEmail: "ada@example.com",
      userName: "Ada",
      message: "I paid 5000 and my wallet is still empty",
    });
    expect(second.actions[0]?.status ?? "skipped").not.toBe("succeeded");
    const [still] = await database.select().from(users).where(eq(users.id, USER));
    expect(still.walletBalance).toBe(5000);
  }, 20_000);

  it("will not credit a deposit the provider has not confirmed", async () => {
    await database.insert(paymentTopups).values({ reference: "TOP-pending-2", userId: USER, amount: 2500, status: "pending" });
    mocks.verifyPayment.mockResolvedValue({
      status: true,
      data: {
        status: "pending",
        reference: "TOP-pending-2",
        currency: "NGN",
        amount: 250000,
        requested_amount: 250000,
        customer: { email: "ada@example.com" },
      },
    });

    const { ticket } = await tickets.createTicket({ userId: USER, body: "my deposit has not arrived" });
    const result = await assistant.respondToTicket({
      ticketId: ticket.id,
      userId: USER,
      userEmail: "ada@example.com",
      userName: "Ada",
      message: "my deposit has not arrived",
    });

    expect(result.actions[0].status).toBe("skipped");
    const [account] = await database.select().from(users).where(eq(users.id, USER));
    expect(account.walletBalance).toBe(0);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  }, 20_000);

  it("refuses another account's deposit even when it is asked to re-check one", async () => {
    await database.insert(paymentTopups).values({ reference: "TOP-other", userId: OTHER, amount: 9000, status: "pending" });
    const outcome = await actions.runSupportRemedy({
      userId: USER,
      userEmail: "ada@example.com",
      userName: "Ada",
      remedy: "recheck_topup",
      target: { kind: "topup", reference: "TOP-other", amount: 9000 },
      facts: await actions.loadSupportFacts(USER),
    });
    expect(outcome.status).toBe("skipped");
    expect(outcome.note).toContain("not on this account");
    expect(mocks.verifyPayment).not.toHaveBeenCalled();
  });

  it("stops only a schedule that belongs to the asker", async () => {
    await database.insert(scheduledOrders).values({
      id: "11111111-1111-4111-8111-111111111111",
      userId: OTHER,
      service: "numbers",
      productSlug: "uk-number",
      frequency: "monthly",
      nextRunAt: new Date("2026-11-30T10:00:00.000Z"),
      status: "active",
    });

    const outcome = await actions.runSupportRemedy({
      userId: USER,
      userEmail: "ada@example.com",
      userName: "Ada",
      remedy: "cancel_schedule",
      target: { kind: "schedule", id: "11111111-1111-4111-8111-111111111111", label: "UK Number" },
      facts: await actions.loadSupportFacts(USER),
    });

    expect(outcome.status).toBe("skipped");
    const [schedule] = await database
      .select()
      .from(scheduledOrders)
      .where(eq(scheduledOrders.id, "11111111-1111-4111-8111-111111111111"));
    expect(schedule.status).toBe("active");
  });

  it("escalates rather than inventing an answer when it recognises nothing", async () => {
    const { ticket } = await tickets.createTicket({ userId: USER, body: "zxcvbnm qwerty" });
    const result = await assistant.respondToTicket({
      ticketId: ticket.id,
      userId: USER,
      userEmail: "ada@example.com",
      userName: "Ada",
      message: "zxcvbnm qwerty",
    });

    expect(result.outcome).toBe("escalated");
    const [stored] = await database.select().from(supportTickets).where(eq(supportTickets.id, ticket.id));
    expect(stored.status).toBe("escalated");
    expect(stored.escalatedAt).toBeTruthy();
    expect(stored.handledBy).toBeNull();
  });

  it("reads only this account's rows, and nothing it could leak", async () => {
    await database.insert(paymentTopups).values([
      { reference: "TOP-mine", userId: USER, amount: 1000, status: "pending" },
      { reference: "TOP-theirs", userId: OTHER, amount: 7000, status: "pending" },
    ]);
    const facts = await actions.loadSupportFacts(USER);

    expect(facts.topUps.map((topUp) => topUp.reference)).toEqual(["TOP-mine"]);
    expect(facts.account.email).toBe("ada@example.com");
    // The fact object is the assistant's whole world: a field that is not in it
    // cannot be repeated to a customer.
    const serialised = JSON.stringify(facts).toLowerCase();
    for (const forbidden of ["supplier", "wholesale", "providercost", "password", "session", "token"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
