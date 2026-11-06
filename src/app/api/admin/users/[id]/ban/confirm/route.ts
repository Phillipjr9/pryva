import { createHash, randomBytes } from "node:crypto";
import { isVercelPreview } from "@/lib/platform/financial-environment";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  adminBans,
  accountDeletions,
  emailChangeRequests,
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
  walletEmailOutbox,
  walletTransactions,
  webauthnCredentials,
  withdrawals,
} from "@/db/schema";
import { hashPassword } from "@/lib/identity/auth";
import { recordAdminAction } from "@/lib/admin/admin-audit";
import { hashSignal } from "@/lib/admin/fraud";
import { clientIp } from "@/lib/identity/auth-rate-limit";
import { isSameOriginMutation } from "@/lib/platform/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";
import { logger } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";

const FINISHED_WITHDRAWALS: string[] = ["completed", "failed", "rejected"];
const TOMBSTONE_NAME = "Deleted account";

function tombstoneEmail(userId: string): string {
  return `deleted+${userId}@deleted.pryva.invalid`;
}

/**
 * POST /api/admin/users/[id]/ban/confirm?token=...
 *
 * Confirms an operator-requested account closure. The raw token from the
 * confirmation email is hashed and matched against the pending ban record.
 * When it matches and is still unexpired, the account is closed: identity is
 * scrubbed, sessions are destroyed, `deleted_at` is stamped, and the financial
 * record is retained exactly as in self-service closure.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  }
  if (isVercelPreview()) {
    return NextResponse.json({ error: "Account bans are unavailable in preview" }, { status: 503 });
  }

  // The confirmation is authorised by the token in the email, not by the
  // caller's session. Any holder of the link can confirm — that is the point
  // of a single-use confirmation link. We still require same-origin to keep
  // CSRF off the endpoint.
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  const admin = access.user;

  const { id: userId } = await params;

  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 512);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { token } = body as { token?: unknown };
  if (typeof token !== "string" || token.length === 0) {
    // The link itself carries the token; the body is only needed when the
    // confirmation is posted without a query parameter. Accept either.
    return NextResponse.json({ error: "Confirmation token is required" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const result = await db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(adminBans)
      .where(and(eq(adminBans.tokenHash, tokenHash), eq(adminBans.userId, userId)))
      .limit(1);

    if (!pending) return { kind: "not_found" as const };
    if (pending.confirmedAt) return { kind: "already_confirmed" as const };
    if (pending.expiresAt < new Date()) return { kind: "expired" as const };

    const [account] = await tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        deletedAt: users.deletedAt,
        walletBalance: users.walletBalance,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);

    if (!account) return { kind: "not_found" as const };
    if (account.deletedAt) return { kind: "already_closed" as const };

    // A payout still in the air means closing would hide the money from its
    // owner. Refuse rather than close underneath a live withdrawal.
    const [pendingWithdrawals] = await tx
      .select({ total: count() })
      .from(withdrawals)
      .where(and(eq(withdrawals.userId, userId), notInArray(withdrawals.status, FINISHED_WITHDRAWALS)));
    if (Number(pendingWithdrawals?.total ?? 0) > 0) {
      return { kind: "withdrawal_in_flight" as const };
    }

    const now = new Date();
    const forfeited = 0; // Admin-initiated closure: the balance is not forfeited.

    // Count what is retained for the receipt (counts, never contents).
    const [orderCount] = await tx.select({ total: count() }).from(orders).where(eq(orders.userId, userId));
    const [ledgerCount] = await tx
      .select({ total: count() })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId));
    const [depositCount] = await tx
      .select({ total: count() })
      .from(paymentTopups)
      .where(eq(paymentTopups.userId, userId));
    const [withdrawalCount] = await tx
      .select({ total: count() })
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId));
    const [giftCardCount] = await tx
      .select({ total: count() })
      .from(giftCards)
      .where(eq(giftCards.purchasedBy, userId));
    const [ticketCount] = await tx
      .select({ total: count() })
      .from(supportTickets)
      .where(eq(supportTickets.userId, userId));
    const [reviewCount] = await tx
      .select({ total: count() })
      .from(productReviews)
      .where(eq(productReviews.userId, userId));

    const retained = {
      orders: Number(orderCount?.total ?? 0),
      walletTransactions: Number(ledgerCount?.total ?? 0),
      deposits: Number(depositCount?.total ?? 0),
      withdrawals: Number(withdrawalCount?.total ?? 0),
      giftCards: Number(giftCardCount?.total ?? 0),
      supportTickets: Number(ticketCount?.total ?? 0),
      reviews: Number(reviewCount?.total ?? 0),
    };

    // Scrub the identity, keep the row. Every auth path reads deletedAt.
    const sealedPassword = hashPassword(randomBytes(32).toString("hex"));
    await tx
      .update(users)
      .set({
        name: TOMBSTONE_NAME,
        email: tombstoneEmail(userId),
        deletedEmailHash: hashSignal(`email:${account.email}`),
        passwordHash: sealedPassword,
        googleSubject: null,
        emailVerifiedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        deletedAt: now,
      })
      .where(eq(users.id, userId));

    // Destroy every credential and session that could sign in or recover.
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
    await tx.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
    await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
    await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, userId));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));
    await tx.delete(emailChangeRequests).where(eq(emailChangeRequests.userId, userId));
    // Drop in-flight notification snapshots that may carry the former address.
    await tx.delete(walletEmailOutbox).where(eq(walletEmailOutbox.userId, userId));

    await tx.insert(accountDeletions).values({
      userId: userId,
      deletedAt: now,
      reason: "admin_close",
      retained,
      forfeited,
      ipHash: hashSignal(clientIp(request)),
    });

    await tx
      .update(adminBans)
      .set({ confirmedAt: now })
      .where(eq(adminBans.id, pending.id));

    return {
      kind: "done" as const,
      email: account.email,
      retained,
    };
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "No pending ban confirmation for this account." }, { status: 404 });
  }
  if (result.kind === "already_confirmed") {
    return NextResponse.json({ error: "This ban confirmation has already been used." }, { status: 409 });
  }
  if (result.kind === "expired") {
    return NextResponse.json({ error: "The confirmation link has expired. Ask an administrator to request a new one." }, { status: 410 });
  }
  if (result.kind === "already_closed") {
    return NextResponse.json({ error: "This account is already closed." }, { status: 409 });
  }
  if (result.kind === "withdrawal_in_flight") {
    return NextResponse.json(
      { error: "A withdrawal from this account is still being processed. Wait until it settles, then request closure again." },
      { status: 409 },
    );
  }

  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "user.ban",
    targetType: "user",
    targetId: userId,
    summary: `Confirmed account closure for ${result.email}`,
  });

  logger.info("Account closed by admin ban confirmation", { adminId: admin.id, userId, retained: result.retained });

  return NextResponse.json({
    ok: true,
    message: "Account closed. The identity has been removed and the account can no longer sign in.",
    retained: result.retained,
  });
}
