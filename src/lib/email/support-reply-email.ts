import { brandedNotificationEmail } from "@/lib/email/email-templates";
import type { ResendPayload } from "@/lib/email/wallet-email-template";

/**
 * A human answered, but the conversation stays behind the customer's login.
 * Never copy a ticket subject, message body, or internal assistant trace into
 * email; those can contain sensitive customer information.
 */
export function makeSupportReplyEmail(input: {
  ticketId: string;
  recipient: string;
  sender: string;
  name: string;
  createdAt: Date;
}): ResendPayload {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.ticketId) ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipient) || input.recipient.length > 200 ||
      !input.sender || input.sender.length > 255 || /[\r\n]/.test(input.sender) ||
      !Number.isFinite(input.createdAt.getTime())) throw new Error("Invalid notification data");

  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "there";
  const recorded = input.createdAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const email = brandedNotificationEmail({
    subject: "Pryva support replied to your request",
    eyebrow: "Support update",
    title: "You have a reply from support",
    intro: `Hi ${name}, a member of our support team has replied. Sign in to read the message and respond.`,
    hero: "support-reply",
    heroAlt: "Support headset and message",
    rows: [{ label: "Reply recorded", value: recorded }],
    ctaPath: `/dashboard/support/${input.ticketId}`,
    ctaLabel: "Open my support request",
    note: "For your privacy, your conversation is not included in this email. Pryva will never ask for your password or security codes by email.",
  });
  return { from: input.sender, to: [input.recipient], ...email };
}
