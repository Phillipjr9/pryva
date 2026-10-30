import { NextRequest, NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { respondToTicket } from "@/lib/ai-support";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { supportMessageRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { createTicket, isValidTicketBody, listTicketsForUser } from "@/lib/support-tickets";

export const dynamic = "force-dynamic";

/** The customer's own tickets. Scoped by session, never by a query parameter. */
export async function GET() {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const tickets = await listTicketsForUser(user.id, 30);
  return NextResponse.json(
    { tickets: tickets.map((ticket) => ({ id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority, lastActivityAt: ticket.lastActivityAt })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Open a ticket and let the assistant answer it immediately.
 *
 * The reply is written in the same request on purpose: a support chat that says
 * "we will get back to you" has not improved on email. If the assistant cannot
 * answer, the ticket is escalated in the same breath and the customer is told —
 * which is still faster than a queue.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });

  const limit = await supportMessageRateLimiter(`support:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Support is temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "That is a lot of messages in a short time. Please try again in a few minutes." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 16_384);
  } catch (error) {
    return NextResponse.json(
      { error: "That message is too long." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { message, subject } = body as { message?: unknown; subject?: unknown };
  if (!isValidTicketBody(message)) {
    return NextResponse.json({ error: "Please describe the problem in a sentence or two." }, { status: 400 });
  }
  if (subject !== undefined && typeof subject !== "string") {
    return NextResponse.json({ error: "Invalid subject." }, { status: 400 });
  }

  try {
    const { ticket } = await createTicket({
      userId: user.id,
      body: message,
      subject: typeof subject === "string" ? subject : undefined,
    });

    const result = await respondToTicket({
      ticketId: ticket.id,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      message,
    });

    return NextResponse.json({
      ok: true,
      ticketId: ticket.id,
      reply: result.reply,
      status: result.status,
      outcome: result.outcome,
      fixed: result.actions.some((action) => action.status === "succeeded"),
    });
  } catch (error) {
    logger.error("Failed to open a support ticket", { error, userId: user.id });
    return NextResponse.json({ error: "We couldn't open that ticket. Please try again." }, { status: 500 });
  }
}
