import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { logger } from "@/lib/platform/logger";

export type ChatNotificationType = "new_message" | "chat_reply";

/**
 * Create a pop-up notification for a user when someone replies on their ticket.
 */
export async function notifyUserOfChatReply(params: {
  userId: string;
  ticketId: string;
  ticketSubject: string;
  actorName: string;
  actorRole: "admin" | "assistant";
}) {
  const title =
    params.actorRole === "admin"
      ? `Support team replied on “${params.ticketSubject}”`
      : `Assistant replied on “${params.ticketSubject}”`;
  const message =
    params.actorRole === "admin"
      ? `${params.actorName} sent you a reply. Open the conversation to read it.`
      : `${params.actorName} answered your question. Open the conversation to read it.`;

  try {
    await db.insert(notifications).values({
      userId: params.userId,
      type: "chat_reply",
      title,
      message,
      read: 0,
    });
  } catch (error) {
    logger.error("Failed to create chat reply notification", {
      error,
      userId: params.userId,
      ticketId: params.ticketId,
    });
  }
}

/**
 * Create pop-up notifications for all configured admins when a customer messages.
 * The notification is sent to every admin address so any operator can pick it up.
 */
export async function notifyAdminsOfNewMessage(params: {
  ticketId: string;
  ticketSubject: string;
  customerName: string;
  customerEmail: string;
}) {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (adminEmails.length === 0) {
    logger.warn("No ADMIN_EMAILS configured; skipping new-message chat notifications");
    return;
  }

  const title = `New message on “${params.ticketSubject}”`;
  const message = `${params.customerName} (${params.customerEmail}) sent a reply. Open the ticket to respond.`;

  for (const email of adminEmails) {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!admin) continue;

    try {
      await db.insert(notifications).values({
        userId: admin.id,
        type: "new_message",
        title,
        message,
        read: 0,
      });
    } catch (error) {
      logger.error("Failed to create new-message notification", {
        error,
        adminId: admin.id,
        ticketId: params.ticketId,
      });
    }
  }
}
