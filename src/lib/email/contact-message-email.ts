import "server-only";

import { resendConfigured } from "@/lib/email/resend-config";
import { brandedNotificationEmail } from "@/lib/email/email-templates";
import { logger } from "@/lib/platform/logger";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import type { ResendPayload } from "@/lib/email/wallet-email-template";

const EMAIL_TIMEOUT_MS = 8_000;
const SUPPORT_ALERT_MAX_RECIPIENTS = 5;
const SUPPORT_ALERT_EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

function displayName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "there";
}

function normalizeTopic(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "your request";
}

function previewText(value: string, max = 180): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "No message details were included.";
}

export function supportAlertRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SUPPORT_ALERT_EMAIL?.trim() || env.FRAUD_ALERT_EMAIL?.trim() || env.ADMIN_EMAILS?.trim() || "";
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const address = part.trim().toLowerCase();
    if (!address || seen.has(address) || !SUPPORT_ALERT_EMAIL_PATTERN.test(address)) continue;
    seen.add(address);
    if (seen.size >= SUPPORT_ALERT_MAX_RECIPIENTS) break;
  }
  return [...seen];
}

export function makeContactMessageConfirmationEmail(input: {
  recipient: string;
  name: string;
  topic: string;
  receivedAt: Date;
}): ResendPayload {
  const when = input.receivedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const email = brandedNotificationEmail({
    subject: "We received your message",
    eyebrow: "Message received",
    title: "We received your message",
    intro: `Hi ${displayName(input.name)}, thanks for reaching out about ${normalizeTopic(input.topic)}. We have your message and a member of the team will review it soon.`,
    hero: "support-reply",
    heroAlt: "Support team response",
    rows: [{ label: "Topic", value: normalizeTopic(input.topic) }, { label: "Received", value: when }],
    ctaPath: "/contact",
    ctaLabel: "Send another note",
    note: "If this is urgent or time-sensitive, use your dashboard support queue or a secure account page. We reply to the email address on the message.",
  });
  return { from: process.env.RESEND_FROM_EMAIL!.trim(), to: [input.recipient], ...email };
}

export function makeContactStatusUpdateEmail(input: {
  recipient: string;
  name: string;
  topic: string;
  status: "in_progress" | "resolved" | "closed";
  updatedAt: Date;
}): ResendPayload {
  const when = input.updatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const label = input.status === "resolved" ? "Resolved" : input.status === "closed" ? "Closed" : "In progress";
  const email = brandedNotificationEmail({
    subject: input.status === "resolved" ? "Pryva has an update on your message" : "Pryva support updated your message",
    eyebrow: "Support update",
    title: input.status === "resolved" ? "Your request has been updated" : "We’ve updated your message",
    intro: `Hi ${displayName(input.name)}, the status of your request about ${normalizeTopic(input.topic)} is now ${label.toLowerCase()}. A member of the Pryva team has reviewed it.`,
    hero: "support-reply",
    heroAlt: "Support message update",
    rows: [{ label: "Topic", value: normalizeTopic(input.topic) }, { label: "Status", value: label }, { label: "Updated", value: when }],
    ctaPath: "/contact",
    ctaLabel: "View the contact page",
    note: "For your privacy, we do not include the full message body in this email. If you need to add more details, send another note through the contact page.",
  });
  return { from: process.env.RESEND_FROM_EMAIL!.trim(), to: [input.recipient], ...email };
}

async function sendResendEmail(payload: ResendPayload): Promise<boolean> {
  if (!resendConfigured()) {
    logger.warn("Contact email skipped: mail not configured");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn("Contact email refused by the mail provider", { status: response.status });
      return false;
    }

    let data: unknown;
    try {
      data = await readJsonWithLimit(response, 32_768);
    } catch {
      // A 2xx response with an empty or invalid provider payload is accepted but
      // the message id is not guaranteed to be present.
    }

    const id = data && typeof data === "object" && !Array.isArray(data) ? (data as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length === 0 || id.length > 100) {
      logger.warn("Contact email acceptance unconfirmed");
      return false;
    }

    return true;
  } catch {
    logger.warn("Contact email failed or timed out");
    return false;
  }
}

export async function sendContactMessageConfirmation(input: {
  to: string;
  name: string;
  topic: string;
  receivedAt?: Date;
}): Promise<boolean> {
  if (!resendConfigured()) {
    logger.warn("Contact email skipped: mail not configured");
    return false;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || input.to.length > 200) {
    logger.warn("Contact email skipped: invalid recipient", { email: input.to });
    return false;
  }
  const email = makeContactMessageConfirmationEmail({
    recipient: input.to,
    name: input.name,
    topic: input.topic,
    receivedAt: input.receivedAt ?? new Date(),
  });
  return sendResendEmail(email);
}

export async function sendContactStatusUpdate(input: {
  to: string;
  name: string;
  topic: string;
  status: "in_progress" | "resolved" | "closed";
  updatedAt?: Date;
}): Promise<boolean> {
  if (!resendConfigured()) {
    logger.warn("Contact status email skipped: mail not configured");
    return false;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || input.to.length > 200) {
    logger.warn("Contact status email skipped: invalid recipient", { email: input.to });
    return false;
  }
  const email = makeContactStatusUpdateEmail({
    recipient: input.to,
    name: input.name,
    topic: input.topic,
    status: input.status,
    updatedAt: input.updatedAt ?? new Date(),
  });
  return sendResendEmail(email);
}

export async function sendNewUserSignupAlert(input: {
  name: string;
  email: string;
  createdAt?: Date;
  status?: "pending_verification" | "verified";
}): Promise<boolean> {
  const recipients = supportAlertRecipients();
  if (!resendConfigured() || recipients.length === 0) {
    logger.warn("New signup alert skipped: no configured operator inbox");
    return false;
  }

  const createdAt = input.createdAt ?? new Date();
  const when = createdAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const statusLabel = input.status === "verified" ? "Verified" : "Awaiting email verification";
  const email = brandedNotificationEmail({
    subject: `New customer signup: ${displayName(input.name)}`,
    eyebrow: "New customer",
    title: "A new customer joined Pryva",
    intro: `${displayName(input.name)} signed up with ${input.email.trim().toLowerCase()}.`,
    hero: "support-reply",
    heroAlt: "New customer account notice",
    rows: [
      { label: "Name", value: displayName(input.name) },
      { label: "Email", value: input.email.trim().toLowerCase() },
      { label: "Joined", value: when },
      { label: "Status", value: statusLabel },
    ],
    ctaPath: "/admin/users",
    ctaLabel: "Review account",
    note: "This is an internal operator notification for new customer signups. Use the admin console to review, verify and support the account.",
  });

  return sendResendEmail({ from: process.env.RESEND_FROM_EMAIL!.trim(), to: recipients, ...email });
}

export async function sendSupportAlertForContactMessage(input: {
  name: string;
  email: string;
  topic: string;
  message: string;
  receivedAt?: Date;
}): Promise<boolean> {
  const recipients = supportAlertRecipients();
  if (!resendConfigured() || recipients.length === 0) {
    logger.warn("Support alert skipped: no configured operator inbox");
    return false;
  }

  const email = brandedNotificationEmail({
    subject: `New contact message: ${normalizeTopic(input.topic)}`,
    eyebrow: "New inquiry",
    title: "A customer sent a new support message",
    intro: `${displayName(input.name)} (${input.email.trim().toLowerCase()}) asked about ${normalizeTopic(input.topic)}.`,
    hero: "support-reply",
    heroAlt: "Operator support inbox",
    rows: [
      { label: "Customer", value: displayName(input.name) },
      { label: "Email", value: input.email.trim().toLowerCase() },
      { label: "Topic", value: normalizeTopic(input.topic) },
      { label: "Preview", value: previewText(input.message) },
    ],
    ctaPath: "/admin/messages",
    ctaLabel: "Review this message",
    note: "This is an internal operator alert. Reply from the admin console or mark the request as resolved once you have handled it.",
  });

  return sendResendEmail({ from: process.env.RESEND_FROM_EMAIL!.trim(), to: recipients, ...email });
}

export async function sendSupportAlertForTicket(input: {
  ticketId: string;
  subject: string;
  userName: string;
  userEmail: string;
  message: string;
  createdAt?: Date;
}): Promise<boolean> {
  const recipients = supportAlertRecipients();
  if (!resendConfigured() || recipients.length === 0) {
    logger.warn("Support ticket alert skipped: no configured operator inbox");
    return false;
  }

  const email = brandedNotificationEmail({
    subject: `New support request: ${normalizeTopic(input.subject)}`,
    eyebrow: "New request",
    title: "A customer opened a support ticket",
    intro: `${displayName(input.userName)} (${input.userEmail.trim().toLowerCase()}) needs help with ${normalizeTopic(input.subject)}.`,
    hero: "support-reply",
    heroAlt: "Support ticket alert",
    rows: [
      { label: "Customer", value: displayName(input.userName) },
      { label: "Email", value: input.userEmail.trim().toLowerCase() },
      { label: "Subject", value: normalizeTopic(input.subject) },
      { label: "Preview", value: previewText(input.message) },
    ],
    ctaPath: `/admin/support/${input.ticketId}`,
    ctaLabel: "Open this ticket",
    note: "This is an internal alert for the support queue. Use the admin console to reply, assign, or resolve the request.",
  });

  return sendResendEmail({ from: process.env.RESEND_FROM_EMAIL!.trim(), to: recipients, ...email });
}
