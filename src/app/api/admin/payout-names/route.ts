import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { db } from "@/db";
import { bankAccounts, payoutNameApprovals, users } from "@/db/schema";
import { logger } from "@/lib/logger";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { isSameOriginMutation } from "@/lib/net";
import { depositorNameFor, payoutApprovalFor } from "@/lib/withdrawal-name-check";
import { payoutDestinationBlocked } from "@/lib/payout-name-review";

export const dynamic = "force-dynamic";

/** Only accounts this recently active are worth scanning for a review queue. */
const SCAN_LIMIT = 500;

/**
 * The payout-name review queue.
 *
 * The payout rule is strict on purpose, and its strictness has a cost: a genuine
 * customer whose signup name is shorter than their bank record is refused. Until
 * now the refusal said "contact support" and support had nothing to act with.
 * This endpoint is that missing tool — it shows which saved accounts a payout
 * would refuse, and records an administrator's reviewed name so the same person
 * can be paid without loosening the rule for anybody else.
 *
 * GET never returns a bank account number in full: an operator reviewing a name
 * needs the last four digits and the name, and nothing else.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    const rows = await db
      .select({
        accountId: bankAccounts.id,
        userId: bankAccounts.userId,
        accountName: bankAccounts.accountName,
        bankName: bankAccounts.bankName,
        accountNumber: bankAccounts.accountNumber,
        userName: users.name,
        userEmail: users.email,
      })
      .from(bankAccounts)
      .innerJoin(users, eq(bankAccounts.userId, users.id))
      .orderBy(desc(bankAccounts.createdAt))
      .limit(SCAN_LIMIT);

    // Group by account holder: the depositor name and any approval are properties
    // of the account, and one lookup per user is cheaper than one per account.
    const byUser = new Map<string, { userId: string; userName: string; userEmail: string; accounts: typeof rows }>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { userId: row.userId, userName: row.userName, userEmail: row.userEmail, accounts: [] };
      entry.accounts.push(row);
      byUser.set(row.userId, entry);
    }

    const blocked: Array<Record<string, unknown>> = [];
    for (const entry of byUser.values()) {
      const blockedAccounts = [];
      for (const account of entry.accounts) {
        if (await payoutDestinationBlocked(entry.userId, account.accountName)) {
          blockedAccounts.push({
            id: account.accountId,
            bankName: account.bankName,
            accountName: account.accountName,
            accountNumberLast4: account.accountNumber.slice(-4),
          });
        }
      }
      if (blockedAccounts.length === 0) continue;
      blocked.push({
        userId: entry.userId,
        userName: entry.userName,
        userEmail: entry.userEmail,
        depositorName: await depositorNameFor(entry.userId),
        approvedName: await payoutApprovalFor(entry.userId),
        accounts: blockedAccounts,
      });
    }

    return NextResponse.json({ ok: true, users: blocked, count: blocked.length });
  } catch (error) {
    logger.error("Failed to build the payout-name review queue", { error });
    return NextResponse.json({ error: "Failed to load payout names" }, { status: 500 });
  }
}

/**
 * Approve a payout name for one account.
 *
 * The approved name does not replace the depositor name frozen on the deposit —
 * that row is the evidence of what was recorded when the money arrived. It sits
 * beside it and widens only which bank-account names this one customer may be
 * paid to, until it is revoked.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;
    const admin = access.user;
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 4_096);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { userId, approvedName, reason } = body as { userId?: unknown; approvedName?: unknown; reason?: unknown };

    if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return NextResponse.json({ error: "A user id is required." }, { status: 400 });
    }
    if (typeof approvedName !== "string" || approvedName.trim().length < 2 || approvedName.trim().length > 200) {
      return NextResponse.json({ error: "Enter the name the bank has on the account." }, { status: 400 });
    }
    // A reason is mandatory: this is a decision about somebody's money, and the
    // next administrator has to be able to see why it was made.
    if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500) {
      return NextResponse.json({ error: "Record why the names were treated as the same person (at least 5 characters)." }, { status: 400 });
    }

    const [account] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!account) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const approved = approvedName.trim().replace(/\s+/g, " ");
    const note = reason.trim();
    const depositorName = await depositorNameFor(userId);

    await db.transaction(async (tx) => {
      // One live approval per account: replace rather than accumulate, so there
      // is never a question of which approved name is in force.
      await tx
        .update(payoutNameApprovals)
        .set({ revokedAt: new Date(), revokedByEmail: admin.email })
        .where(and(eq(payoutNameApprovals.userId, userId), isNull(payoutNameApprovals.revokedAt)));
      await tx.insert(payoutNameApprovals).values({
        userId,
        approvedName: approved,
        depositorName,
        reason: note,
        approvedByEmail: admin.email,
      });
    });

    await recordAdminAction({
      actor: admin,
      action: "user.payout_name",
      targetType: "user",
      targetId: userId,
      summary: `Approved payout name "${approved}" for ${account.email} (depositor name on record: ${depositorName ?? "none"}). Reason: ${note}`,
    });
    logger.info("Payout name approved", { userId, adminId: admin.id });

    return NextResponse.json({ ok: true, approvedName: approved });
  } catch (error) {
    logger.error("Failed to approve a payout name", { error });
    return NextResponse.json({ error: "Failed to approve the payout name" }, { status: 500 });
  }
}

/** Revoke a live approval; the frozen depositor rule applies again immediately. */
export async function DELETE(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;
    const admin = access.user;

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const userId = body && typeof body === "object" && !Array.isArray(body) ? (body as { userId?: unknown }).userId : undefined;
    if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return NextResponse.json({ error: "A user id is required." }, { status: 400 });
    }

    const revoked = await db
      .update(payoutNameApprovals)
      .set({ revokedAt: new Date(), revokedByEmail: admin.email })
      .where(and(eq(payoutNameApprovals.userId, userId), isNull(payoutNameApprovals.revokedAt)))
      .returning({ approvedName: payoutNameApprovals.approvedName });
    if (revoked.length === 0) return NextResponse.json({ error: "No approval is in force for this account." }, { status: 404 });

    await recordAdminAction({
      actor: admin,
      action: "user.payout_name_revoke",
      targetType: "user",
      targetId: userId,
      summary: `Revoked payout name "${revoked[0].approvedName}". The depositor-name rule applies again.`,
    });
    logger.info("Payout name approval revoked", { userId, adminId: admin.id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to revoke a payout name", { error });
    return NextResponse.json({ error: "Failed to revoke the payout name" }, { status: 500 });
  }
}
