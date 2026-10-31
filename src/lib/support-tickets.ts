import { and, count, desc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { supportMessages, supportTickets } from "@/db/schema";

import type { SupportCategory, SupportPriority, SupportStatus } from "./ai-support/types";

/**
 * The support ticket, as data.
 *
 * Nothing in here decides anything: it reads and writes threads, and enforces
 * the two invariants that matter — a ticket belongs to exactly one customer, and
 * every read of a customer's ticket is scoped to that customer. The assistant's
 * judgement lives in `ai-support/engine.ts`; this file is the shelf it stands on.
 */

export type TicketRow = typeof supportTickets.$inferSelect;
export type TicketMessageRow = typeof supportMessages.$inferSelect;

const MAX_SUBJECT = 160;
const MAX_BODY = 8_000;

export function isValidTicketBody(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.length <= MAX_BODY;
}

/**
 * A subject line the customer did not have to type.
 *
 * The first sentence, trimmed to something a queue can show. Deliberately not
 * "Support request #4" — the operator scanning twenty of those learns nothing.
 */
export function subjectFromBody(body: string): string {
  const firstLine = body.trim().split(/\n/)[0] ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const trimmed = firstSentence.trim();
  if (trimmed.length <= MAX_SUBJECT) return trimmed || "Support request";
  return `${trimmed.slice(0, MAX_SUBJECT - 1).trimEnd()}…`;
}

export async function createTicket(input: {
  userId: string;
  body: string;
  subject?: string;
  channel?: "dashboard" | "contact";
}): Promise<{ ticket: TicketRow; message: TicketMessageRow }> {
  const body = input.body.trim();
  const subject = (input.subject?.trim() || subjectFromBody(body)).slice(0, MAX_SUBJECT);

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      userId: input.userId,
      subject,
      status: "open",
      priority: "normal",
      channel: input.channel ?? "dashboard",
      lastActivityAt: new Date(),
    })
    .returning();

  const [message] = await db
    .insert(supportMessages)
    .values({ ticketId: ticket.id, authorRole: "customer", authorUserId: input.userId, body })
    .returning();

  return { ticket, message };
}

export async function getTicketForUser(userId: string, ticketId: string): Promise<TicketRow | null> {
  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
    .limit(1);
  return ticket ?? null;
}

export async function getTicket(ticketId: string): Promise<TicketRow | null> {
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
  return ticket ?? null;
}

export async function getThread(ticketId: string): Promise<TicketMessageRow[]> {
  return db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(supportMessages.createdAt);
}

export async function listTicketsForUser(userId: string, limit = 20): Promise<TicketRow[]> {
  return db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.lastActivityAt))
    .limit(limit);
}

export async function addCustomerMessage(input: {
  ticket: TicketRow;
  userId: string;
  body: string;
}): Promise<TicketMessageRow> {
  const body = input.body.trim();
  const [message] = await db
    .insert(supportMessages)
    .values({ ticketId: input.ticket.id, authorRole: "customer", authorUserId: input.userId, body })
    .returning();

  // A customer writing reopens a resolved thread rather than starting a second
  // one: the history is the context, and splitting it loses exactly that.
  //
  // `resolvedAt` and `handledBy` are cleared with it. A ticket that says
  // "resolved by the assistant" while its newest message is an unanswered
  // customer complaint is worse than no status at all.
  await db
    .update(supportTickets)
    .set({
      status: "open",
      lastActivityAt: new Date(),
      closedAt: null,
      resolvedAt: null,
      handledBy: null,
    })
    .where(eq(supportTickets.id, input.ticket.id));

  return message;
}

export async function addAssistantMessage(input: {
  ticketId: string;
  body: string;
  trace: string;
  status: SupportStatus;
  priority: SupportPriority;
  category: SupportCategory;
  confidence: number;
  escalated: boolean;
  resolved: boolean;
}): Promise<TicketMessageRow> {
  const now = new Date();
  const [message] = await db
    .insert(supportMessages)
    .values({ ticketId: input.ticketId, authorRole: "assistant", body: input.body, trace: input.trace })
    .returning();

  await db
    .update(supportTickets)
    .set({
      status: input.status,
      priority: input.priority,
      category: input.category,
      assistantConfidence: Math.round(input.confidence * 100),
      lastActivityAt: now,
      escalatedAt: input.escalated ? now : null,
      resolvedAt: input.resolved ? now : null,
      handledBy: input.resolved ? "assistant" : null,
    })
    .where(eq(supportTickets.id, input.ticketId));

  return message;
}

export async function addAdminMessage(input: {
  ticket: TicketRow;
  adminId: string;
  body: string;
  status: SupportStatus;
}): Promise<TicketMessageRow> {
  const [message] = await db
    .insert(supportMessages)
    .values({ ticketId: input.ticket.id, authorRole: "admin", authorUserId: input.adminId, body: input.body })
    .returning();

  const now = new Date();
  await db
    .update(supportTickets)
    .set({
      status: input.status,
      lastActivityAt: now,
      handledBy: input.status === "resolved" || input.status === "closed" ? "admin" : input.ticket.handledBy,
      resolvedAt: input.status === "resolved" ? now : input.ticket.resolvedAt,
      closedAt: input.status === "closed" ? now : null,
      assignedAdminId: input.ticket.assignedAdminId ?? input.adminId,
    })
    .where(eq(supportTickets.id, input.ticket.id));

  return message;
}

export async function setTicketState(input: {
  ticketId: string;
  status?: SupportStatus;
  priority?: SupportPriority;
}): Promise<void> {
  const now = new Date();
  const patch: Record<string, unknown> = { lastActivityAt: now };
  if (input.status) {
    patch.status = input.status;
    patch.resolvedAt = input.status === "resolved" ? now : null;
    patch.closedAt = input.status === "closed" ? now : null;
  }
  if (input.priority) patch.priority = input.priority;
  await db.update(supportTickets).set(patch).where(eq(supportTickets.id, input.ticketId));
}

export async function escalateTicket(ticketId: string): Promise<void> {
  await db
    .update(supportTickets)
    .set({ status: "escalated", escalatedAt: new Date(), lastActivityAt: new Date(), handledBy: null })
    .where(and(eq(supportTickets.id, ticketId), ne(supportTickets.status, "closed")));
}

/** Queue counters for the admin rail. Open means nobody is looking yet. */
export async function ticketQueueSummary(): Promise<{
  open: number;
  escalated: number;
  waiting: number;
  resolvedToday: number;
}> {
  const [openRow] = await db.select({ total: count() }).from(supportTickets).where(eq(supportTickets.status, "open"));
  const [escalatedRow] = await db.select({ total: count() }).from(supportTickets).where(eq(supportTickets.status, "escalated"));
  const [waitingRow] = await db.select({ total: count() }).from(supportTickets).where(eq(supportTickets.status, "waiting_on_customer"));
  const [resolvedRow] = await db
    .select({ total: count() })
    .from(supportTickets)
    .where(and(eq(supportTickets.status, "resolved"), sql`${supportTickets.resolvedAt} > now() - interval '1 day'`));
  return {
    open: Number(openRow?.total ?? 0),
    escalated: Number(escalatedRow?.total ?? 0),
    waiting: Number(waitingRow?.total ?? 0),
    resolvedToday: Number(resolvedRow?.total ?? 0),
  };
}
