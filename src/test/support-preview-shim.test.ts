import { describe, expect, it } from "vitest";

import { persistentDatabaseConfigured } from "@/lib/database-config";

/**
 * Support in the preview, where there is no database at all.
 *
 * The preview runs on the in-memory adapter in `src/db/index.ts`, and a feature
 * that only works against Postgres looks finished in CI and broken in the
 * environment the owner actually clicks through. This exercises the real module
 * against that adapter: open a ticket, read it back, and check that the assistant
 * refuses to pretend it can reach Paystack from there.
 *
 * Skipped entirely when a persistent database is configured — on a real database
 * this would write to it.
 */
const previewOnly = persistentDatabaseConfigured() ? it.skip : it;

describe("support works in the preview too", () => {
  previewOnly("opens, reads back, and replies without a database", async () => {
    const { createTicket, getTicketForUser, getThread, listTicketsForUser } = await import("@/lib/support-tickets");
    const { respondToTicket } = await import("@/lib/ai-support");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");

    const userId = "preview-support-user";
    await db.insert(users).values({
      id: userId,
      name: "Preview Customer",
      email: "preview-support@example.com",
      passwordHash: "x",
      walletBalance: 0,
    });

    const { ticket } = await createTicket({ userId, body: "I cannot verify my email address" });

    const listed = await listTicketsForUser(userId);
    expect(listed.some((row) => row.id === ticket.id)).toBe(true);
    expect(await getTicketForUser(userId, ticket.id)).not.toBeNull();
    expect(await getTicketForUser("someone-else", ticket.id)).toBeNull();

    const result = await respondToTicket({
      ticketId: ticket.id,
      userId,
      userEmail: "preview-support@example.com",
      userName: "Preview Customer",
      message: "I cannot verify my email address",
    });

    // It answers from the account's own state, with a trace, without a database.
    expect(result.reply.length).toBeGreaterThan(40);
    expect(result.trace.length).toBeGreaterThanOrEqual(5);

    const thread = await getThread(ticket.id);
    expect(thread.some((message) => message.authorRole === "assistant")).toBe(true);
  }, 20_000);

  previewOnly("never pretends it can reach the payment provider from the preview", async () => {
    const { loadSupportFacts, runSupportRemedy } = await import("@/lib/ai-support");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");

    const userId = "preview-support-user-2";
    await db.insert(users).values({
      id: userId,
      name: "Preview Two",
      email: "preview-two@example.com",
      passwordHash: "x",
      walletBalance: 0,
    });

    const facts = await loadSupportFacts(userId);
    expect(facts.paymentsReady).toBe(false);

    const outcome = await runSupportRemedy({
      userId,
      userEmail: "preview-two@example.com",
      userName: "Preview Two",
      remedy: "recheck_topup",
      target: { kind: "topup", reference: "TOP-does-not-exist", amount: 1000 },
      facts,
    });
    expect(outcome.status).toBe("skipped");
    expect(outcome.note).toContain("not configured");
  }, 20_000);
});
