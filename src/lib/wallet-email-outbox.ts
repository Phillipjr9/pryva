import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletEmailOutbox, walletTransactions, withdrawals } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { readJsonWithLimit } from "@/lib/request-body";
import { createRateLimiter } from "@/lib/rate-limit";
import { resendConfigured } from "@/lib/resend-config";
import { makeEsimDeliveryEmail } from "@/lib/esim-email-template";
import { makeNumberCodeEmail } from "@/lib/number-email-template";
import { esimQrAttachment } from "@/lib/esim-qr";
import { makeWalletEmail, type ResendPayload, type WalletEmailEvent } from "@/lib/wallet-email-template";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 8_000;
// Resend's default is 10 requests/second/team. Leave headroom for fixed-window
// boundaries and other traffic; separate applications still need coordination.
const resendBudget = createRateLimiter({ windowMs: 1_000, maxRequests: 4 });

type Claimed = { id: string; lock_token: string };
type DispatchResult = "sent" | "retry" | "review" | "empty" | "throttled";
class InvalidNotificationData extends Error {}

/**
 * Kept under its historical name because three call sites and the cron route
 * already use it. The check itself now lives in `@/lib/resend-config` so the
 * auth routes can share it without importing the wallet outbox.
 */
export function walletEmailConfigured(): boolean {
  return resendConfigured();
}

/**
 * Base64 payloads are bounded: two attachments of at most ~1.5 MB is already far
 * more than a QR needs, and an unbounded field is a way to fill the table.
 */
const MAX_ATTACHMENTS = 2;
const MAX_ATTACHMENT_CHARS = 2_000_000;

function validAttachments(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ATTACHMENTS) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const a = entry as { filename?: unknown; content?: unknown; content_id?: unknown };
    return typeof a.filename === "string" && a.filename.length > 0 && a.filename.length <= 100 &&
      !/[\\/\r\n]/.test(a.filename) &&
      typeof a.content === "string" && a.content.length > 0 && a.content.length <= MAX_ATTACHMENT_CHARS &&
      /^[A-Za-z0-9+/=]+$/.test(a.content) &&
      (a.content_id === undefined || (typeof a.content_id === "string" && a.content_id.length > 0 && a.content_id.length <= 60));
  });
}

function validPayload(value: unknown): value is ResendPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Partial<ResendPayload>;
  return typeof p.from === "string" && p.from.length > 0 && p.from.length <= 255 && !/[\r\n]/.test(p.from) &&
    Array.isArray(p.to) && p.to.length === 1 && typeof p.to[0] === "string" && p.to[0].length <= 200 &&
    typeof p.subject === "string" && p.subject.length <= 200 && typeof p.text === "string" && p.text.length <= 10_000 &&
    typeof p.html === "string" && p.html.length <= 20_000 && validAttachments(p.attachments);
}

/**
 * Claim one job atomically across instances. Resend keeps idempotency keys for
 * 24 hours, so an uncertain send older than 23 hours is left for review rather
 * than risking a duplicate after the provider's deduplication window expires.
 */
async function expireUncertainJobs(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE wallet_email_outbox SET status = 'review', last_error = 'idempotency_window_elapsed', locked_until = NULL, lock_token = NULL
    WHERE first_attempt_at < now() - interval '23 hours'
      AND (status = 'pending' OR (status = 'sending' AND (locked_until IS NULL OR locked_until <= now())))
    RETURNING id
  `);
  return result.rows.length;
}

async function claim(): Promise<Claimed | null> {
  const token = randomUUID();
  const result = await db.execute(sql`
    UPDATE wallet_email_outbox AS job
      SET status = 'sending', lock_token = ${token}::uuid, locked_until = now() + interval '2 minutes',
          attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, now())
    WHERE job.id = (
      SELECT id FROM wallet_email_outbox
      WHERE ((status = 'pending' AND available_at <= now())
        OR (status = 'sending' AND (locked_until IS NULL OR locked_until <= now())))
        AND (first_attempt_at IS NULL OR first_attempt_at >= now() - interval '23 hours')
      ORDER BY available_at, created_at
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING job.id, job.lock_token
  `);
  const row = result.rows[0] as Claimed | undefined;
  return row ?? null;
}

async function mark(job: Claimed, status: "sent" | "pending" | "review", error: string | null, providerId?: string): Promise<boolean> {
  const updated = await db.update(walletEmailOutbox).set({
    status,
    lastError: error,
    lockToken: null,
    lockedUntil: null,
    ...(status === "sent" ? { sentAt: new Date(), providerMessageId: providerId ?? null } : {}),
    ...(status === "pending" ? { availableAt: new Date(Date.now() + (error === "provider_configuration" ? 30 * 60_000 : 60_000)) } : {}),
  }).where(and(eq(walletEmailOutbox.id, job.id), eq(walletEmailOutbox.status, "sending"), eq(walletEmailOutbox.lockToken, job.lock_token)))
    .returning({ id: walletEmailOutbox.id });
  return updated.length === 1;
}

async function payloadFor(job: Claimed): Promise<ResendPayload> {
  const [row] = await db.select({
    orderId: walletEmailOutbox.orderId,
    recipient: walletEmailOutbox.recipient,
    eventKind: walletEmailOutbox.eventKind,
    payload: walletEmailOutbox.payload,
    eventTime: walletEmailOutbox.createdAt,
    txType: walletTransactions.type,
    txAmount: walletTransactions.amount,
    txReference: walletTransactions.reference,
    txDescription: walletTransactions.description,
    txTime: walletTransactions.createdAt,
    withdrawalAmount: withdrawals.amount,
    withdrawalReference: withdrawals.reference,
    orderAmount: orders.amount,
    orderReference: orders.reference,
    orderService: orders.service,
    orderProductName: orders.productName,
    orderPlanLabel: orders.planLabel,
    orderRegion: orders.region,
    orderDuration: orders.duration,
    orderActivationCode: orders.esimActivationCode,
    orderInstallUrl: orders.esimInstallUrl,
    orderIccid: orders.esimIccid,
    orderOtpCode: orders.otpCode,
    orderPhoneNumber: orders.referenceCode,
    orderExpiresAt: orders.expiresAt,
  }).from(walletEmailOutbox)
    .leftJoin(walletTransactions, eq(walletEmailOutbox.walletTransactionId, walletTransactions.id))
    .leftJoin(withdrawals, eq(walletEmailOutbox.withdrawalId, withdrawals.id))
    .leftJoin(orders, eq(walletEmailOutbox.orderId, orders.id))
    .where(and(eq(walletEmailOutbox.id, job.id), eq(walletEmailOutbox.status, "sending"), eq(walletEmailOutbox.lockToken, job.lock_token)))
    .limit(1);
  if (!row) throw new Error("Notification no longer available");
  if (row.payload) {
    let saved: unknown;
    try { saved = JSON.parse(row.payload); } catch { throw new InvalidNotificationData(); }
    if (!validPayload(saved)) throw new InvalidNotificationData();
    return saved;
  }

  // The eSIM handover is built from the order itself, and carries the QR as an
  // attachment: the image is generated here rather than fetched from a URL that
  // could be rotated out from under an old email.
  if (row.eventKind === "esim_delivery") {
    if (!row.orderId || !row.orderActivationCode || !row.orderReference) throw new InvalidNotificationData();
    const sender = process.env.RESEND_FROM_EMAIL?.trim();
    if (!sender) throw new InvalidNotificationData();
    const siteUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://pryva.ng").replace(/\/$/, "");
    let delivery: ResendPayload;
    try {
      delivery = makeEsimDeliveryEmail({
        recipient: row.recipient,
        sender,
        orderReference: row.orderReference,
        productName: row.orderProductName ?? "eSIM plan",
        planLabel: row.orderPlanLabel ?? "",
        region: row.orderRegion ?? "",
        duration: row.orderDuration ?? "",
        activationCode: row.orderActivationCode,
        installUrl: row.orderInstallUrl ?? null,
        iccid: row.orderIccid ?? null,
        orderUrl: `${siteUrl}/dashboard/orders/${row.orderId}`,
        attachment: await esimQrAttachment(row.orderActivationCode),
      });
    } catch {
      throw new InvalidNotificationData();
    }
    const [savedEsim] = await db.update(walletEmailOutbox).set({ payload: JSON.stringify(delivery) })
      .where(and(eq(walletEmailOutbox.id, job.id), eq(walletEmailOutbox.status, "sending"), eq(walletEmailOutbox.lockToken, job.lock_token)))
      .returning({ id: walletEmailOutbox.id });
    if (!savedEsim) throw new Error("Notification lease expired");
    return delivery;
  }

  // A verification code is the delivery for a number, and the page is not
  // always open. Same rule as the eSIM: built from the order, never guessed.
  if (row.eventKind === "number_code") {
    if (!row.orderId || !row.orderOtpCode || !row.orderReference) throw new InvalidNotificationData();
    const sender = process.env.RESEND_FROM_EMAIL?.trim();
    if (!sender) throw new InvalidNotificationData();
    const siteUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://pryva.ng").replace(/\/$/, "");
    let notice: ResendPayload;
    try {
      notice = makeNumberCodeEmail({
        recipient: row.recipient,
        sender,
        orderReference: row.orderReference,
        productName: row.orderProductName ?? "Verification number",
        planLabel: row.orderPlanLabel ?? "",
        region: row.orderRegion ?? "",
        phoneNumber: row.orderPhoneNumber ?? null,
        code: row.orderOtpCode,
        expiresAt: row.orderExpiresAt ? new Date(row.orderExpiresAt) : null,
        orderUrl: `${siteUrl}/dashboard/orders/${row.orderId}`,
      });
    } catch {
      throw new InvalidNotificationData();
    }
    const [savedCode] = await db.update(walletEmailOutbox).set({ payload: JSON.stringify(notice) })
      .where(and(eq(walletEmailOutbox.id, job.id), eq(walletEmailOutbox.status, "sending"), eq(walletEmailOutbox.lockToken, job.lock_token)))
      .returning({ id: walletEmailOutbox.id });
    if (!savedCode) throw new Error("Notification lease expired");
    return notice;
  }

  let event: WalletEmailEvent;
  if (row.eventKind === "wallet" && row.txType && row.txAmount != null && row.txReference && row.txDescription != null && row.txTime) {
    event = { kind: "wallet", type: row.txType, amount: row.txAmount, reference: row.txReference, description: row.txDescription, createdAt: new Date(row.txTime) };
  } else if ((row.eventKind === "withdrawal_processing" || row.eventKind === "withdrawal_completed" || row.eventKind === "withdrawal_rejected") && row.withdrawalAmount != null && row.withdrawalReference) {
    event = { kind: row.eventKind, amount: row.withdrawalAmount, reference: row.withdrawalReference, createdAt: new Date(row.eventTime) };
  } else if (row.eventKind === "purchase_completed" && row.orderAmount != null && row.orderReference) {
    event = { kind: "purchase_completed", amount: row.orderAmount, reference: row.orderReference, createdAt: new Date(row.eventTime) };
  } else {
    throw new InvalidNotificationData();
  }
  const testMode = process.env.WALLET_EMAIL_TEST_MODE === "true" || Boolean(process.env.PAYSTACK_SECRET_KEY?.trim().startsWith("sk_test_"));
  let payload: ResendPayload;
  try { payload = makeWalletEmail(event, row.recipient, process.env.RESEND_FROM_EMAIL!.trim(), testMode); }
  catch { throw new InvalidNotificationData(); }
  // Persist the exact payload before contacting Resend. Retries must not change
  // recipients, sender or body while reusing the same idempotency key.
  const [saved] = await db.update(walletEmailOutbox).set({ payload: JSON.stringify(payload) })
    .where(and(eq(walletEmailOutbox.id, job.id), eq(walletEmailOutbox.status, "sending"), eq(walletEmailOutbox.lockToken, job.lock_token)))
    .returning({ id: walletEmailOutbox.id });
  if (!saved) throw new Error("Notification lease expired");
  return payload;
}

async function dispatchOne(): Promise<DispatchResult> {
  // Reserve a shared send budget before claiming, so throttling never starts
  // the 23-hour clock on a job that hasn't been attempted.
  const budget = await resendBudget("resend:wallet-email-budget");
  if (budget.unavailable) throw new Error("Wallet email rate limit unavailable");
  if (!budget.allowed) return "throttled";
  const job = await claim();
  if (!job) return "empty";
  let payload: ResendPayload;
  try {
    payload = await payloadFor(job);
  } catch (error) {
    if (error instanceof InvalidNotificationData) {
      return await mark(job, "review", "invalid_notification_data") ? "review" : "retry";
    }
    // Database or lease failures can be transient; no provider call was made.
    await mark(job, "pending", "notification_unavailable");
    return "retry";
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `pryva-wallet/${job.id}` },
      body: JSON.stringify(payload),
    });
    let data: unknown = null;
    try { data = await readJsonWithLimit(response, 32_768); } catch { /* A malformed response is unconfirmed. */ }
    const result = data && typeof data === "object" && !Array.isArray(data) ? data as { id?: unknown; name?: unknown } : {};
    if (response.ok && typeof result.id === "string" && result.id.length > 0 && result.id.length <= 100) {
      return await mark(job, "sent", null, result.id) ? "sent" : "retry";
    }
    if (response.status === 409 && result.name === "invalid_idempotent_request") {
      return await mark(job, "review", "idempotency_conflict") ? "review" : "retry";
    }
    const error = [400, 401, 403, 422].includes(response.status) ? "provider_configuration" : "provider_unconfirmed";
    await mark(job, "pending", error);
    return "retry";
  } catch {
    // A timeout may follow provider acceptance. Retry the exact same body and
    // idempotency key only inside the bounded provider deduplication window.
    await mark(job, "pending", "provider_unconfirmed");
    return "retry";
  }
}

/** Best-effort dispatch; ledger commits and customer responses never depend on email delivery. */
export async function dispatchWalletEmails(limit = 4): Promise<{ sent: number; retry: number; review: number; throttled: boolean }> {
  const counts = { sent: 0, retry: 0, review: 0, throttled: false };
  if (isPreviewDatabase() || !walletEmailConfigured()) return counts;
  counts.review += await expireUncertainJobs();
  for (let index = 0; index < Math.min(Math.max(limit, 1), 8); index++) {
    const result = await dispatchOne();
    if (result === "empty") break;
    if (result === "throttled") { counts.throttled = true; break; }
    counts[result]++;
  }
  if (counts.retry || counts.review) logger.warn("Wallet email dispatch needs attention", counts);
  return counts;
}
