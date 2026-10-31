import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountDeletions,
  emailVerificationTokens,
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
  retentionSummary,
  sessionIsFresh,
  tombstoneEmail,
} from "@/lib/account-deletion";
import { clientIp } from "@/lib/auth-rate-limit";
import { hashSignal } from "@/lib/fraud";
import { isSameOriginMutation } from "@/lib/net";
import { accountDeletionRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

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
  const fields = body as { confirm?: unknown; password?: unknown; understand?: unknown };

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

    // Step four: never take an account with money in it, or one whose payout is
    // still in the air. Both are checked again inside the transaction.
    const [pending] = await db
      .select({ total: count() })
      .from(withdrawals)
      .where(and(eq(withdrawals.userId, user.id), eq(withdrawals.status, "pending")));
    const block = deletionBlock({
      walletBalance: account.walletBalance,
      pendingWithdrawals: Number(pending?.total ?? 0),
    });
    if (block) {
      return NextResponse.json({ ok: false, ...block }, { status: 409 });
    }

    const now = new Date();
    // A password nobody knows, stored in the normal format: the column stays a
    // real hash (so no future "is this account passwordless?" check misfires) and
    // nothing can ever verify against it.
    const sealedPassword = hashPassword(randomBytes(32).toString("hex"));

    type Result =
      | { kind: "missing" }
      | { kind: "already" }
      | { kind: "blocked"; block: NonNullable<ReturnType<typeof deletionBlock>> }
      | { kind: "done"; retained: Record<string, number> };

    const receipt = await db.transaction(async (tx): Promise<Result> => {
      // The lock is the point: a purchase that read the balance a moment ago must
      // not be able to spend out of an account that is being closed underneath it.
      const [locked] = await tx
        .select({ walletBalance: users.walletBalance, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!locked) return { kind: "missing" };
      if (locked.deletedAt) return { kind: "already" };
      // No withdrawal can have appeared since the check above — the payout paths
      // all take this same row lock — so only the balance is re-read.
      const lateBlock = deletionBlock({ walletBalance: locked.walletBalance, pendingWithdrawals: 0 });
      if (lateBlock) return { kind: "blocked", block: lateBlock };

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
          deletedEmailHash: hashSignal(`email:${account.email}`),
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

      await tx.insert(accountDeletions).values({
        userId: user.id,
        deletedAt: now,
        reason: "self_service",
        retained,
        ipHash: hashSignal(clientIp(request)),
      });

      return { kind: "done", retained };
    });

    if (receipt.kind === "missing") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (receipt.kind === "already") {
      return NextResponse.json({ ok: false, error: "This account is already closed." }, { status: 409 });
    }
    if (receipt.kind === "blocked") {
      return NextResponse.json({ ok: false, ...receipt.block }, { status: 409 });
    }

    // The browser stops being signed in here, not at the next request.
    await destroySession();
    logger.info("Account closed by its owner", { userId: user.id, retained: receipt.retained });

    return NextResponse.json({
      ok: true,
      deleted: true,
      // Said back to the screen so the confirmation the customer sees is the same
      // list they were shown before they confirmed.
      removed: DELETION_TERMS.removed,
      retained: receipt.retained,
    });
  } catch (error) {
    logger.error("Account deletion failed", { userId: user.id, error });
    return NextResponse.json(
      { ok: false, error: "The account could not be closed just now. Nothing was changed — please try again." },
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
