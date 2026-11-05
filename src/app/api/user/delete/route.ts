import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, count, desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountDeletions,
  emailVerificationTokens,
  emailChangeRequests,
  giftCards,
  orders,
  passwordResetTokens,
  paymentTopups,
  productReviews,
  sessions,
  supportTickets,
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  userTwoFactor,
  users,
  walletEmailOutbox,
  walletTransactions,
  webauthnCredentials,
  withdrawals,
} from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_EMBEDDED,
  destroySession,
  hashPassword,
  requireAuthApi,
  verifyPassword,
} from "@/lib/auth";
import {
  DELETION_TERMS,
  TOMBSTONE_NAME,
  confirmationMatches,
  deletionBlock,
  forfeitureWarning,
  retentionSummary,
  sessionIsFresh,
  tombstoneEmail,
} from "@/lib/account-deletion";
import { debitWalletInTx, makeReference } from "@/lib/wallet";
import { clientIp } from "@/lib/auth-rate-limit";
import { hashSignal } from "@/lib/fraud";
import { isSameOriginMutation } from "@/lib/net";
import { accountDeletionRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";
import { scheduleAccountClosedEmail, type AccountClosedNotice } from "@/lib/account-closed-email";

export const dynamic = "force-dynamic";

/** Payout states that are finished; every other value is treated as still moving. */
const FINISHED_WITHDRAWALS: string[] = ["completed", "failed", "rejected"];

/**
 * Close my account.
 *
 * The row survives; the person does not. `users` cascades to orders, the wallet
 * ledger, deposits, withdrawals, gift cards and payment records, so hard deletion
 * would destroy the only evidence that any of that money moved — and a chargeback
 * can arrive months later. Instead the identity is scrubbed, every credential and
 * session is destroyed, `deleted_at` is stamped, and the financial record stays
 * exactly where it was, attached to a row with no name on it.
 *
 * What this asks for before doing anything irreversible:
 *
 *   • a session signed in within the last fifteen minutes — a tab left open on a
 *     shared laptop is not consent to close an account;
 *   • the account's own email address typed out, so a slip of the mouse cannot do
 *     it;
 *   • the password, for accounts that sign in with one (Google-created accounts
 *     never had one — their fresh sign-in is the proof).
 *
 * And what it refuses: an account holding a balance, or one with a withdrawal in
 * flight. Both would leave the owner of that money with no way to ask for it.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ ok: false, error: "Cross-origin request denied" }, { status: 403 });
  }

  // Per account rather than per IP: the account is the thing being destroyed, and
  // a shared network must not let one person's attempts block another's.
  const throttle = await accountDeletionRateLimiter(`account-delete:${user.id}`);
  if (throttle.unavailable) {
    return NextResponse.json({ ok: false, error: "Temporarily unavailable. Try again shortly." }, { status: 503 });
  }
  if (!throttle.allowed) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });
  }

  if (!isJsonRequest(request)) {
    return NextResponse.json({ ok: false, error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 4_096);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const fields = body as { confirm?: unknown; password?: unknown; forfeitAcknowledged?: unknown; forfeitAmount?: unknown };
  const acknowledgedBalance = (balance: number) =>
    fields.forfeitAcknowledged === true && Number.isSafeInteger(fields.forfeitAmount) && fields.forfeitAmount === balance;

  try {
    const jar = await cookies();
    const tokens = [
      jar.get(SESSION_COOKIE)?.value,
      jar.get(SESSION_COOKIE_EMBEDDED)?.value,
    ].filter((value): value is string => Boolean(value));
    if (tokens.length === 0) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // Step one: is this session recent enough to speak for the account?
    const [currentSession] = await db
      .select({ createdAt: sessions.createdAt })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), eq(sessions.token, tokens[0])))
      .orderBy(desc(sessions.createdAt))
      .limit(1);
    if (!sessionIsFresh(currentSession?.createdAt)) {
      return NextResponse.json(
        {
          ok: false,
          code: "SESSION_TOO_OLD",
          error: "For your safety, sign out and sign in again, then close the account — this session has been open too long to delete it.",
        },
        { status: 403 },
      );
    }

    const account = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!account) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (account.deletedAt) {
      return NextResponse.json({ ok: false, error: "This account is already closed." }, { status: 409 });
    }

    // Step two: the typed confirmation. Their address, not a checkbox.
    if (!confirmationMatches(typeof fields.confirm === "string" ? fields.confirm : null, account.email)) {
      return NextResponse.json(
        { ok: false, code: "CONFIRMATION_MISMATCH", error: "Type your email address exactly as it appears on the account." },
        { status: 400 },
      );
    }

    // Step three: the password, for accounts that have one. A Google-created
    // account never had a usable password (`google_subject` is what signs it in),
    // so a fresh sign-in is the proof there; requiring a password it never had
    // would make deletion impossible for exactly those customers.
    const password = typeof fields.password === "string" ? fields.password : "";
    const passwordIsMeaningful = account.googleSubject == null;
    if (passwordIsMeaningful && !password) {
      return NextResponse.json(
        { ok: false, code: "PASSWORD_REQUIRED", error: "Enter your password to confirm." },
        { status: 400 },
      );
    }
    if (password && !verifyPassword(password, account.passwordHash)) {
      // Wording matches the sign-in failure family: no hint about which half was
      // wrong, no confirmation that this account exists to someone guessing.
      return NextResponse.json(
        { ok: false, code: "PASSWORD_MISMATCH", error: "That password does not match this account." },
        { status: 401 },
      );
    }

    // Step four: a payout still in the air is a live claim on a record that would
    // be deleted with the account, so that is refused. A balance is not — it is
    // forfeited, and only with the customer's acknowledgement of the amount.
    // Anything that is not finished counts as live: `pending` and `processing`
    // today, and any status this code has not heard of tomorrow.
    const [pending] = await db
      .select({ total: count() })
      .from(withdrawals)
      .where(and(eq(withdrawals.userId, user.id), notInArray(withdrawals.status, FINISHED_WITHDRAWALS)));
    const block = deletionBlock({ pendingWithdrawals: Number(pending?.total ?? 0) });
    if (block) {
      return NextResponse.json({ ok: false, ...block }, { status: 409 });
    }

    const forfeiture = forfeitureWarning(account.walletBalance);
    if (forfeiture && !acknowledgedBalance(forfeiture.amount)) {
      // The amount is named, and the request is refused until it is acknowledged:
      // a client that never rendered the warning cannot lose money because of it.
      return NextResponse.json(
        {
          ok: false,
          code: "FORFEITURE_NOT_ACKNOWLEDGED",
          error: `${forfeiture.message} Refresh this page to review the current amount.`,
          detail: { balance: forfeiture.amount },
        },
        { status: 409 },
      );
    }

    // A password nobody knows, stored in the normal format: the column stays a
    // real hash (so no future "is this account passwordless?" check misfires) and
    // nothing can ever verify against it.
    const sealedPassword = hashPassword(randomBytes(32).toString("hex"));

    type Result =
      | { kind: "missing" }
      | { kind: "already" }
      | { kind: "identity-changed" }
      | { kind: "blocked"; block: NonNullable<ReturnType<typeof deletionBlock>> }
      | { kind: "done"; retained: Record<string, number>; forfeited: number; notice: AccountClosedNotice | null };

    const receipt = await db.transaction(async (tx): Promise<Result> => {
      // The lock is the point: a purchase that read the balance a moment ago must
      // not be able to spend out of an account that is being closed underneath it.
      const [locked] = await tx
        .select({
          walletBalance: users.walletBalance, deletedAt: users.deletedAt,
          email: users.email, emailVerifiedAt: users.emailVerifiedAt,
          passwordHash: users.passwordHash, googleSubject: users.googleSubject,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!locked) return { kind: "missing" };
      if (locked.deletedAt) return { kind: "already" };
      // The typed address and authentication proof were checked before the
      // lock. If either identity changed while waiting, start again instead of
      // closing a different state or notifying an obsolete address.
      if (locked.email !== account.email || locked.passwordHash !== account.passwordHash || locked.googleSubject !== account.googleSubject) {
        return { kind: "identity-changed" };
      }

      // A payout may have started after the first check. Withdrawals insert a
      // user-referencing row before debiting the owner, so recheck after locking
      // the owner rather than closing while a committed payout is in flight.
      const [pendingNow] = await tx.select({ total: count() }).from(withdrawals)
        .where(and(eq(withdrawals.userId, user.id), notInArray(withdrawals.status, FINISHED_WITHDRAWALS)));
      const lateBlock = deletionBlock({ pendingWithdrawals: Number(pendingNow?.total ?? 0) });
      if (lateBlock) return { kind: "blocked", block: lateBlock };

      // Acknowledgement names an amount, not just a boolean: an intervening
      // credit must not be forfeited under consent for a smaller balance.
      const lateForfeiture = forfeitureWarning(locked.walletBalance);
      if (lateForfeiture && !acknowledgedBalance(lateForfeiture.amount)) {
        return {
          kind: "blocked",
          block: {
            code: "FORFEITURE_NOT_ACKNOWLEDGED",
            error: `${lateForfeiture.message} Refresh this page to review the current amount.`,
            action: { label: "Go to wallet", href: "/dashboard/wallet" },
            detail: { withdrawals: 0 },
          },
        };
      }

      const now = new Date();
      // The forfeiture is written into the ledger, not just the receipt: a wallet
      // that drops to zero without a row explaining why would break the invariant
      // the nightly close checks (`previous ± amount = balance_after`).
      const forfeited = locked.walletBalance;
      if (forfeited > 0) {
        await debitWalletInTx(tx, {
          userId: user.id,
          amount: forfeited,
          type: "debit",
          description: "Account closed — balance forfeited",
          reference: makeReference("CLS"),
        });
      }

      const [orderCount] = await tx.select({ total: count() }).from(orders).where(eq(orders.userId, user.id));
      const [ledgerCount] = await tx
        .select({ total: count() })
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, user.id));
      const [depositCount] = await tx
        .select({ total: count() })
        .from(paymentTopups)
        .where(eq(paymentTopups.userId, user.id));
      const [withdrawalCount] = await tx
        .select({ total: count() })
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id));
      const [giftCardCount] = await tx
        .select({ total: count() })
        .from(giftCards)
        .where(eq(giftCards.purchasedBy, user.id));
      const [ticketCount] = await tx
        .select({ total: count() })
        .from(supportTickets)
        .where(eq(supportTickets.userId, user.id));
      const [reviewCount] = await tx
        .select({ total: count() })
        .from(productReviews)
        .where(eq(productReviews.userId, user.id));

      const retained = retentionSummary({
        orders: Number(orderCount?.total ?? 0),
        walletTransactions: Number(ledgerCount?.total ?? 0),
        deposits: Number(depositCount?.total ?? 0),
        withdrawals: Number(withdrawalCount?.total ?? 0),
        giftCards: Number(giftCardCount?.total ?? 0),
        supportTickets: Number(ticketCount?.total ?? 0),
        reviews: Number(reviewCount?.total ?? 0),
      });

      await tx
        .update(users)
        .set({
          name: TOMBSTONE_NAME,
          email: tombstoneEmail(user.id),
          // The fingerprint is taken of the *old* address before it is replaced,
          // so a person who writes in later can still be matched to these rows.
          deletedEmailHash: hashSignal(`email:${locked.email}`),
          passwordHash: sealedPassword,
          googleSubject: null,
          emailVerifiedAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          deletedAt: now,
        })
        .where(eq(users.id, user.id));

      // Everything that could sign this account in, or be used to recover it.
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
      await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id));
      await tx.delete(userTwoFactor).where(eq(userTwoFactor.userId, user.id));
      await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, user.id));
      await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, user.id));
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
      await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id));
      await tx.delete(emailChangeRequests).where(eq(emailChangeRequests.userId, user.id));
      // Notification snapshots can contain the former address and, for service
      // deliveries, credentials. Keep the financial ledger, not its mail copies.
      // An already in-flight provider request cannot be recalled here.
      await tx.delete(walletEmailOutbox).where(eq(walletEmailOutbox.userId, user.id));

      await tx.insert(accountDeletions).values({
        userId: user.id,
        deletedAt: now,
        reason: "self_service",
        retained,
        forfeited,
        ipHash: hashSignal(clientIp(request)),
      });

      // The verified address is handed back only in memory after commit; it is
      // not added to the database receipt or the durable mail outbox.
      const notice = locked.emailVerifiedAt ? { to: locked.email, when: now } : null;
      return { kind: "done", retained, forfeited, notice };
    });

    if (receipt.kind === "missing") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (receipt.kind === "already") {
      return NextResponse.json({ ok: false, error: "This account is already closed." }, { status: 409 });
    }
    if (receipt.kind === "identity-changed") {
      return NextResponse.json({ ok: false, error: "Your account details changed. Sign in again before closing it." }, { status: 409 });
    }
    if (receipt.kind === "blocked") {
      return NextResponse.json({ ok: false, ...receipt.block }, { status: 409 });
    }

    // No email is sent for an unverified address. This is one in-memory,
    // post-commit attempt; the deletion remains successful if scheduling fails.
    if (receipt.notice) {
      try { scheduleAccountClosedEmail(receipt.notice); } catch { logger.warn("Account closure notice could not be scheduled"); }
    }
    // Session rows are already deleted in the transaction. A cookie-clearing
    // failure must not turn a completed closure into a false failure response.
    try { await destroySession(); } catch { logger.warn("Closed account cookie could not be cleared"); }
    logger.info("Account closed by its owner", {
      userId: user.id,
      retained: receipt.retained,
      forfeited: receipt.forfeited,
    });

    return NextResponse.json({
      ok: true,
      deleted: true,
      // Said back to the screen so the confirmation the customer sees is the same
      // list they were shown before they confirmed.
      removed: DELETION_TERMS.removed,
      retained: receipt.retained,
      forfeited: receipt.forfeited,
    });
  } catch {
    // Database errors can include query parameters or addresses. Keep the
    // operator alert, but never copy the exception into retained logs.
    logger.error("Account deletion could not be confirmed", { userId: user.id });
    return NextResponse.json(
      { ok: false, error: "We couldn't confirm whether your account closed. Try signing in or contact support before trying again." },
      { status: 500 },
    );
  }
}

/**
 * Kept so an old client cannot believe deletion happened.
 *
 * The previous implementation of this route was a `DELETE` that always answered
 * `503`; anything still calling it gets a pointer to the real request rather than a
 * silent no-op.
 */
export async function DELETE() {
  return NextResponse.json(
    { ok: false, error: "Use POST to close an account." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
