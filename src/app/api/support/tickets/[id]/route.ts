import { NextRequest, NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { respondToTicket } from "@/lib/ai-support";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { supportMessageRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import {
  addCustomerMessage,
  escalateTicket,
  getTicketForUser,
  getThread,
  isValidTicketBody,
} from "@/lib/support-tickets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const TICKET_ID = /^[0-9a-f-]{36}$/i;

/** The thread, for the signed-in customer who owns it. */
export async function GET(_request: NextRequest, { params }: Params) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await params;
  if (!TICKET_ID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ticket = await getTicketForUser(user.id, id);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const messages = await getThread(ticket.id);
  return NextResponse.json(
    {
      ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority },
      // `trace` is deliberately absent: it is the operator's copy of the
      // assistant's reasoning, not part of the conversation.
      messages: messages.map((message) => ({
        id: message.id,
        role: message.authorRole,
        body: message.body,
        createdAt: message.createdAt,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Reply on a ticket, or hand it to a person.
 *
 * `action: "escalate"` exists so a customer who does not want to talk to the
 * assistant can say so without having to argue with it first.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });

  const { id } = await params;
  if (!TICKET_ID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

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
  const { message, action } = body as { message?: unknown; action?: unknown };

  const ticket = await getTicketForUser(user.id, id);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (action === "escalate") {
    await escalateTicket(ticket.id);
    return NextResponse.json({ ok: true, status: "escalated", reply: null });
  }
  if (action !== undefined && action !== "reply") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  if (!isValidTicketBody(message)) {
    return NextResponse.json({ error: "Please write a message." }, { status: 400 });
  }

  try {
    await addCustomerMessage({ ticket, userId: user.id, body: message });
    const result = await respondToTicket({
      ticketId: ticket.id,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      message,
    });
    return NextResponse.json({
      ok: true,
      reply: result.reply,
      status: result.status,
      outcome: result.outcome,
      fixed: result.actions.some((entry) => entry.status === "succeeded"),
    });
  } catch (error) {
    logger.error("Failed to reply on a support ticket", { error, ticketId: ticket.id });
    return NextResponse.json({ error: "Your message was saved but the reply failed. A person will pick it up." }, { status: 500 });
  }
}
