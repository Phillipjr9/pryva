import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REMEDY_IDS, SUPPORT_STATUSES } from "@/lib/ai-support/types";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * What the assistant is allowed to touch, as a test.
 *
 * The interesting risk in an "AI support agent" is not that it says something
 * odd — it is that it does something irreversible. So the capability list is
 * asserted here, at the only place capabilities exist:
 *
 *   * the remedy vocabulary is exactly three entries,
 *   * the module that runs them cannot reach a wallet, a refund, a withdrawal or
 *     a payout, and
 *   * every customer-facing surface is scoped to the signed-in account.
 */
describe("the assistant's capabilities are a closed list", () => {
  it("has exactly three remedies, all reversible or read-only", () => {
    expect([...REMEDY_IDS]).toEqual(["resend_verification", "recheck_topup", "cancel_schedule"]);
  });

  it("cannot reach money, payouts or account privilege", () => {
    const actions = read("src/lib/ai-support/actions.ts");
    for (const forbidden of [
      "creditWallet",
      "debitWallet",
      "initiateTransfer",
      "refundGiftCard",
      "createTransferRecipient",
      // Reading a balance is fine; writing one is not.
      "update(users)",
      "set({ walletBalance",
    ]) {
      expect(actions, forbidden).not.toContain(forbidden);
    }
    // Crediting a *verified* deposit is the one money-adjacent path it has, and
    // it goes through the same idempotent function the webhook uses.
    expect(actions).toContain("reconcileTopUpPayment");
    expect(actions).toContain("cancelScheduledOrder");
  });

  it("keeps every decision out of the language model", () => {
    const model = read("src/lib/ai-support/model.ts");
    // The model rewrites prose. It is never asked what to do.
    expect(model).toContain("polishSupportReply");
    expect(model).not.toContain("runRemedy");
    expect(model).not.toContain("remedy");
    const index = read("src/lib/ai-support/index.ts");
    // And an escalated reply is never re-worded, so the hand-over sentence is
    // exactly the one the engine wrote.
    expect(index).toContain('result.outcome === "escalated" ? null : await polishSupportReply');
  });
});

describe("support surfaces are scoped to the account", () => {
  it("the customer's list is the session's own", () => {
    const page = read("src/app/dashboard/support/page.tsx");
    expect(page).toContain('await requireUser("/dashboard/support")');
    expect(page).toContain("listTicketsForUser(user.id");
    expect(page).not.toContain("searchParams");
  });

  it("the thread 404s rather than showing somebody else's ticket", () => {
    const page = read("src/app/dashboard/support/[id]/page.tsx");
    expect(page).toContain("getTicketForUser(user.id, id)");
    expect(page).toContain("notFound()");
    // The assistant's reasoning stays on the operator's screen.
    expect(page).not.toContain("message.trace");
  });

  it("the api refuses anonymous calls and cross-origin writes", () => {
    for (const route of ["src/app/api/support/tickets/route.ts", "src/app/api/support/tickets/[id]/route.ts"]) {
      const source = read(route);
      expect(source, route).toContain("requireAuthApi()");
      expect(source, route).toContain("isSameOriginMutation(request)");
      expect(source, route).toContain("supportMessageRateLimiter");
    }
    // Opening a ticket lists nothing but the session's own; the thread route is
    // the one that has to resolve an id, so that is where the ownership check
    // has to be.
    expect(read("src/app/api/support/tickets/route.ts")).toContain("listTicketsForUser(user.id");
    expect(read("src/app/api/support/tickets/[id]/route.ts")).toContain("getTicketForUser(user.id, id)");
  });

  it("the admin side is behind the admin gate and the audit log", () => {
    expect(read("src/app/admin/support/page.tsx")).toContain('await requireAdmin("/admin/support")');
    const detail = read("src/app/admin/support/[id]/page.tsx");
    expect(detail).toContain('await requireAdmin("/admin/support")');
    // The operator can read the reasoning; that is the point of escalating.
    expect(detail).toContain("How it decided this");
    expect(detail).toContain("message.trace");

    const api = read("src/app/api/admin/support/[id]/route.ts");
    expect(api).toContain("authorizeAdminApi(request)");
    expect(api).toContain("isSameOriginMutation(request)");
    expect(api).toContain('action: "support.reply"');
    expect(api).toContain('targetType: "support_ticket"');
  });

  it("has the tables and the migration it claims", () => {
    expect(existsSync("migrations/0019_support_tickets.sql")).toBe(true);
    const sql = read("migrations/0019_support_tickets.sql");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "support_tickets"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "support_messages"');
    expect(sql).toContain('REFERENCES "users"("id") ON DELETE CASCADE');

    const schema = read("src/db/schema.ts");
    expect(schema).toContain('pgTable(\n  "support_tickets"');
    expect(schema).toContain('pgTable(\n  "support_messages"');
  });

  it("shows the customer every state the model can hold", () => {
    // A status the dashboard cannot label would render as a raw database string.
    const pill = read("src/components/support/SupportStatusPill.tsx");
    for (const status of SUPPORT_STATUSES) {
      expect(read("src/lib/ai-support/types.ts")).toContain(status);
      expect(pill).toContain(status);
    }
  });

  it("offers a way out of the assistant from inside the conversation", () => {
    // The guarantee survived the rewrite: the button lives in the chat now, which
    // is the only component either entry point uses.
    const chat = read("src/components/support/SupportChat.tsx");
    expect(chat).toContain("Ask for a person instead");
    expect(chat).toContain('action: "escalate"');
    expect(chat).toContain("/api/support/tickets/");
  });
});
