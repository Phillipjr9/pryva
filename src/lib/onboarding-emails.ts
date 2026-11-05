import "server-only";

import { after } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { onboardingEmailLog, users } from "@/db/schema";
import { customerWelcomeEmail, emailVerifiedEmail } from "@/lib/email-templates";
import { logger } from "@/lib/logger";
import { resendConfigured } from "@/lib/resend-config";

/**
 * The two emails a new account receives exactly once: a receipt for the
 * verification, and a welcome.
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
 *   • **Exactly once, enforced by a unique index.** Two callers can reach the
 *     moment of verification together -- the token confirm route and the resend
 *     route's already-verified branch. Both may try to send; the database decides
 *     which one is first, and the loser is a no-op rather than a second email.
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
 * `duplicate` is a success, not a skip: it means this account already has that
 * mail, which is the guarantee the unique index exists to provide. `ineligible`
 * means there was nothing to send -- the address was never confirmed, or the
 * account is closed.
 */
export type OnboardingEmailOutcome = "accepted" | "refused" | "skipped" | "duplicate" | "ineligible";

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

/** The provider's own words, bounded -- never the whole body, which can echo the address. */
function refusalDetail(status: number, body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed?.message === "string") message = parsed.message;
  } catch {
    message = "";
  }
  const readable = message.replace(/\s+/g, " ").trim().slice(0, 150);
  return readable ? `${status}: ${readable}` : `provider refused the message (${status})`;
}

/**
 * Claim the right to send one kind to one account.
 *
 * An insert into a table with a unique `(user_id, kind)` index is the lock: the
 * winner gets a row back and sends, every loser gets nothing back and sends
 * nothing. `onConflictDoNothing().returning()` therefore returns `[]` on a
 * duplicate, which is exactly the signal wanted -- no read-then-write race.
 */
async function claim(userId: string, kind: OnboardingEmailKind): Promise<string | null> {
  try {
    const [row] = await db
      .insert(onboardingEmailLog)
      .values({ userId, kind, status: "pending" })
      .onConflictDoNothing()
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
  result: { status: "accepted" | "refused" | "skipped"; messageId?: string | null; detail?: string | null },
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
): Promise<{ status: "accepted" | "refused" | "skipped"; messageId?: string | null; detail?: string | null }> {
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
      method: "POST",
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
      const body = await response.text().catch(() => "");
      logger.error("Onboarding email refused by the provider", {
        kind,
        status: response.status,
        detail: body.slice(0, 200),
      });
      return { status: "refused", detail: refusalDetail(response.status, body) };
    }
    const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
    const messageId = typeof payload?.id === "string" ? payload.id : null;
    logger.info("Onboarding email accepted by the provider", { kind, messageId });
    return { status: "accepted", messageId };
  } catch (error) {
    logger.error("Onboarding email could not be sent", {
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "refused", detail: "the mail service could not be reached" };
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
        // Only rows that are missing at least one of the two, so a completed
        // account is never re-read on every run.
        sql`NOT EXISTS (
          SELECT 1 FROM onboarding_email_log l
          WHERE l.user_id = ${users.id} AND l.kind = 'welcome' AND l.status = 'accepted'
        )`,
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
