import "server-only";

import { after } from "next/server";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { onboardingEmailLog, users } from "@/db/schema";
import { customerWelcomeEmail, emailVerifiedEmail } from "@/lib/email/email-templates";
import { logger } from "@/lib/platform/logger";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { resendConfigured } from "@/lib/email/resend-config";

/**
 * The two onboarding emails for a newly verified account: a verification
 * receipt and a welcome. Provider acceptance is not proof of delivery.
 *
 * Both used to be missing. Confirming an address ended in silence, and
 * `welcomeEmail()` sat in the template library with no caller. Nothing failed and
 * nothing logged -- the sequence simply stopped, which is why it went unnoticed.
 *
 * Three rules shape this module, and they exist because of how the other email
 * paths in this app have failed:
 *
 *   • **Never inside the transaction that verified the address.** The receipt is
 *     a courtesy on top of a completed action. A mail outage must not roll back a
 *     verification, and a slow provider must not hold a database lock while the
 *     customer waits for a page that has already done its job.
 *   • **One claim per account and kind.** A unique index serializes concurrent
 *     callers. Definite refusals can retry; ambiguous sends remain in review
 *     instead of risking a duplicate.
 *   • **Never for an account that is gone.** The address is read from `users` at
 *     send time, and a closed account has neither a real address nor any reason to
 *     be written to.
 *
 * Failure is recorded, not raised. The row's `status` says what the provider
 * answered, so a `refused` row is the operator-visible evidence that a welcome
 * never went out -- the alternative was a console line nobody reads.
 */

export const ONBOARDING_EMAIL_KINDS = ["verified", "welcome"] as const;
export type OnboardingEmailKind = (typeof ONBOARDING_EMAIL_KINDS)[number];

/**
 * What became of one email.
 *
 * `duplicate` means another caller has already claimed the notification. Its
 * state may be accepted, in-flight, or held for review; it is not proof that
 * the recipient received it. `ineligible` means the account is not eligible.
 */
export type OnboardingEmailOutcome = "accepted" | "refused" | "skipped" | "review" | "duplicate" | "ineligible";

type Recipient = {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
};

type Template = { subject: string; html: string; text: string };

function templateFor(kind: OnboardingEmailKind, recipient: Recipient): Template {
  const verifiedAt = recipient.emailVerifiedAt ?? new Date();
  return kind === "verified"
    ? emailVerifiedEmail(recipient.name, recipient.email, verifiedAt)
    : customerWelcomeEmail(recipient.name);
}

/**
 * Claim the right to send one kind to one account.
 *
 * A unique `(user_id, kind)` row is the lock. A definite refusal or a skipped
 * unconfigured send can be claimed again after the operator fixes the sender.
 * Ambiguous timeouts/5xx remain in review: without a frozen payload and a
 * provider idempotency key, automatically retrying them could duplicate mail.
 */
async function claim(userId: string, kind: OnboardingEmailKind): Promise<string | null> {
  try {
    const [row] = await db
      .insert(onboardingEmailLog)
      .values({ userId, kind, status: "pending" })
      .onConflictDoUpdate({
        target: [onboardingEmailLog.userId, onboardingEmailLog.kind],
        set: { status: "pending", detail: null },
        setWhere: inArray(onboardingEmailLog.status, ["refused", "skipped"]),
      })
      .returning({ id: onboardingEmailLog.id });
    return row?.id ?? null;
  } catch (error) {
    // A missing table (an older database) must not break verification itself.
    logger.warn("Onboarding email could not be claimed", {
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function settle(
  logId: string,
  result: { status: "accepted" | "refused" | "skipped" | "review"; messageId?: string | null; detail?: string | null },
): Promise<void> {
  try {
    await db
      .update(onboardingEmailLog)
      .set({
        status: result.status,
        providerMessageId: result.messageId?.slice(0, 100) ?? null,
        detail: result.detail?.slice(0, 200) ?? null,
        sentAt: result.status === "accepted" ? new Date() : null,
      })
      .where(eq(onboardingEmailLog.id, logId));
  } catch (error) {
    // The email is already gone; a bookkeeping failure is not worth a retry.
    logger.warn("Onboarding email outcome could not be recorded", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deliver(
  kind: OnboardingEmailKind,
  recipient: Recipient,
): Promise<{ status: "accepted" | "refused" | "skipped" | "review"; messageId?: string | null; detail?: string | null }> {
  if (!resendConfigured()) {
    // Reported rather than sent-and-failed: without a key nothing can leave, and
    // pretending otherwise would leave the log claiming an attempt was made.
    return { status: "skipped", detail: "email delivery is not configured on this server" };
  }
  const key = process.env.RESEND_API_KEY!.trim();
  const from = process.env.RESEND_FROM_EMAIL!.trim();
  const template = templateFor(kind, recipient);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipient.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
      // The person is waiting on a page that has already succeeded, so this must
      // never be the slowest thing in the request.
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      // Provider bodies can echo addresses or other private data. The status is
      // sufficient for operators to investigate without copying the response.
      logger.error("Onboarding email refused by the provider", { kind, status: response.status });
      // Only an explicit 4xx refusal is safe to retry without risking a second
      // copy. A 5xx may occur after acceptance, so hold it for an operator.
      return { status: response.status >= 400 && response.status < 500 ? "refused" : "review", detail: `provider refused the message (${response.status})` };
    }
    const payload = await readJsonWithLimit(response, 32_768).catch(() => null) as { id?: unknown } | null;
    const messageId = typeof payload?.id === "string" && payload.id.length > 0 && payload.id.length <= 100 ? payload.id : null;
    if (!messageId) {
      logger.error("Onboarding email response was unconfirmed", { kind });
      return { status: "review", detail: "provider response did not confirm acceptance" };
    }
    logger.info("Onboarding email accepted by the provider", { kind, messageId });
    return { status: "accepted", messageId };
  } catch {
    logger.error("Onboarding email could not be sent", { kind });
    return { status: "review", detail: "the mail service could not be reached; delivery is unconfirmed" };
  }
}

/**
 * Send both onboarding emails for an account that is verified now.
 *
 * Order matters: the receipt first. A welcome that arrived before the receipt
 * would answer a question the customer did not ask and skip the one they did
 * ("did my click work?"). Both are independent -- one failing does not stop the
 * other, because a missing welcome is a disappointment and a missing receipt is
 * a support ticket about whether the verification happened at all.
 *
 * Safe to call from anywhere, any number of times, for any account. Accounts that
 * are unverified, closed, or already mailed are silently passed over, so this can
 * be the one call site in the confirm route and the Google callback without
 * either having to reason about the other.
 */
export async function sendOnboardingEmails(
  userId: string,
): Promise<Record<OnboardingEmailKind, OnboardingEmailOutcome>> {
  // Both start `ineligible`, so any early return below reports the truth for the
  // *whole* sequence rather than leaving the second slot claiming a send.
  const result: Record<OnboardingEmailKind, OnboardingEmailOutcome> = {
    verified: "ineligible",
    welcome: "ineligible",
  };

  let recipient: Recipient | undefined;
  try {
    [recipient] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
  } catch (error) {
    logger.warn("Onboarding emails skipped: the account could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  // Not verified yet: there is no milestone to report, and a welcome would go to
  // an address nobody has proven they can read.
  if (!recipient || !recipient.emailVerifiedAt || recipient.deletedAt) return result;

  for (const kind of ONBOARDING_EMAIL_KINDS) {
    const logId = await claim(userId, kind);
    if (!logId) {
      result[kind] = "duplicate";
      continue;
    }
    const outcome = await deliver(kind, recipient);
    await settle(logId, outcome);
    result[kind] = outcome.status;
  }

  return result;
}

/**
 * Run the onboarding sequence after the response is on the wire.
 *
 * Every caller of this is a request the customer is watching. The verification is
 * already committed by the time it is called, so the mail must not be able to
 * delay that response or, worse, turn it into an error -- the token is spent, and
 * a retry would fail even though the account is verified.
 *
 * Contexts without a Next.js request (a script, a cron handler invoked directly)
 * have no `after` hook; there the send is skipped rather than awaited inline,
 * because the durable path back to a missed welcome is `backfillOnboardingEmails`
 * in the nightly job.
 */
export function scheduleOnboardingEmails(userId: string): void {
  try {
    after(async () => {
      try {
        await sendOnboardingEmails(userId);
      } catch (error) {
        logger.warn("Onboarding emails failed after the response", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  } catch {
    logger.warn("Onboarding emails deferred: no request context for `after`", {});
  }
}

/**
 * The same two emails for everybody who verified but never received them.
 *
 * Everyone who confirmed an address before this shipped is in that state: their
 * verification is real, their welcome never happened, and re-verifying is not
 * possible (the token is consumed). This lets the nightly job -- or an operator
 * with a broken sequence to fix -- finish the job for them, in bounded batches.
 *
 * Only accounts created inside `sinceDays` are considered. A customer from eight
 * months ago receiving a "welcome aboard" invitation to get started is worse than
 * silence: it reads as a phishing attempt, and the habit it trains is to ignore
 * mail from this domain.
 */
export async function backfillOnboardingEmails(options: {
  limit?: number;
  sinceDays?: number;
} = {}): Promise<{ considered: number; sent: number }> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const sinceDays = Math.max(options.sinceDays ?? 30, 1);

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.emailVerifiedAt),
        sql`${users.deletedAt} IS NULL`,
        sql`${users.createdAt} > now() - ${sql.raw(`interval '${sinceDays} days'`)}`,
        // A welcome can succeed even if its receipt was refused. Check both;
        // ambiguous/in-flight rows are not retryable and must not starve others.
        sql`(NOT EXISTS (
          SELECT 1 FROM onboarding_email_log l
          WHERE l.user_id = ${users.id} AND l.kind = 'welcome' AND l.status NOT IN ('refused', 'skipped')
        ) OR NOT EXISTS (
          SELECT 1 FROM onboarding_email_log l
          WHERE l.user_id = ${users.id} AND l.kind = 'verified' AND l.status NOT IN ('refused', 'skipped')
        ))`,
      ),
    )
    .limit(limit);

  let sent = 0;
  for (const row of rows) {
    const outcome = await sendOnboardingEmails(row.id);
    if (outcome.verified === "accepted" || outcome.welcome === "accepted") sent += 1;
  }
  return { considered: rows.length, sent };
}
