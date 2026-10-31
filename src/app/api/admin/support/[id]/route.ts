import { NextRequest, NextResponse } from "next/server";

import { recordAdminAction } from "@/lib/admin-audit";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { isSupportPriority, isSupportStatus } from "@/lib/ai-support/types";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { addAdminMessage, getTicket, setTicketState } from "@/lib/support-tickets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const TICKET_ID = /^[0-9a-f-]{36}$/i;

/**
 * Answer a ticket, or move it.
 *
 * An admin reply always lands in the thread — including when it is only a status
 * change — because a ticket that silently changes state teaches the customer
 * nothing. The reply is evaluated before the write so a malformed body cannot
 * half-move a ticket.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 16_384);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { id } = await params;
    if (!TICKET_ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { status, priority, reply } = body as { status?: unknown; priority?: unknown; reply?: unknown };
    if (status !== undefined && !isSupportStatus(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (priority !== undefined && !isSupportPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }
    if (reply !== undefined && (typeof reply !== "string" || reply.trim().length < 2 || reply.length > 8_000)) {
      return NextResponse.json({ error: "Invalid reply" }, { status: 400 });
    }

    const ticket = await getTicket(id);
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // The columns are free-text varchars, so a row written before a status
    // existed would otherwise leak a string the rest of the app cannot handle.
    const currentStatus = isSupportStatus(ticket.status) ? ticket.status : "open";
    const currentPriority = isSupportPriority(ticket.priority) ? ticket.priority : "normal";
    const nextStatus = isSupportStatus(status) ? status : currentStatus;
    const nextPriority = isSupportPriority(priority) ? priority : currentPriority;

    if (typeof reply === "string" && reply.trim().length > 0) {
      await addAdminMessage({
        ticket,
        adminId: access.user.id,
        body: reply.trim(),
        status: nextStatus,
      });
    } else {
      await setTicketState({ ticketId: ticket.id, status: nextStatus, priority: nextPriority });
    }

    await recordAdminAction({
      actor: access.user,
      action: "support.reply",
      targetType: "support_ticket",
      targetId: ticket.id,
      // The customer's words and ours are not copied into the audit row: the
      // thread is the record of the conversation, and an audit row is the record
      // of who did what.
      summary: typeof reply === "string" && reply.trim().length > 0
        ? `Replied on a support ticket and set it to ${nextStatus}`
        : `Support ticket moved to ${nextStatus} (priority ${nextPriority})`,
    });

    return NextResponse.json({ ok: true, status: nextStatus, priority: nextPriority });
  } catch (error) {
    logger.error("Failed to update a support ticket", { error });
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
