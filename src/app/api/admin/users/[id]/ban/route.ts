import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { adminAuditLog, scheduledOrders, sessions, twoFactorChallenges, users } from "@/db/schema";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { isAdminUser } from "@/lib/identity/auth";
import { isVercelPreview } from "@/lib/platform/financial-environment";
import { logger } from "@/lib/platform/logger";
import { isSameOriginMutation } from "@/lib/platform/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";
import { scheduleAdminBanEmail } from "@/lib/email/admin-ban-email";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reversible suspension: never delete customer identity or financial history. */
async function change(request: NextRequest, params: Promise<{ id: string }>, suspend: boolean) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  if (isVercelPreview()) return NextResponse.json({ error: "Suspensions are unavailable in preview" }, { status: 503 });
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  const admin = access.user;
  const { id: userId } = await params;
  if (!UUID.test(userId)) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  let body: unknown;
  try { body = await readJsonWithLimit(request, 2048); }
  catch (error) { return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const rawReason = (body as { reason?: unknown }).reason;
  if (rawReason !== undefined && (typeof rawReason !== "string" || rawReason.length > 200)) return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : null;

  try {
    const result = await db.transaction(async (tx) => {
      // This lock is also taken when a session is created, so a successful
      // sign-in racing suspension cannot resurrect access after reinstatement.
      const [account] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
      if (!account) return { kind: "not_found" as const };
      if (account.deletedAt) return { kind: "closed" as const };
      if (account.id === admin.id || isAdminUser(account)) return { kind: "administrator" as const };
      const changed = suspend ? !account.suspendedAt : !!account.suspendedAt;
      if (!changed) return { kind: "unchanged" as const };
      const now = new Date();
      await tx.update(users).set({ suspendedAt: suspend ? now : null }).where(eq(users.id, userId));
      if (suspend) {
        await tx.delete(sessions).where(eq(sessions.userId, userId));
        await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, userId));
        // Paused schedules stay paused after reinstatement. In-flight provider
        // calls must still be reconciled; suspension cannot undo an upstream buy.
        await tx.update(scheduledOrders).set({ status: "paused" }).where(and(eq(scheduledOrders.userId, userId), inArray(scheduledOrders.status, ["active", "processing"])));
      }
      await tx.insert(adminAuditLog).values({
        actorId: admin.id, actorEmail: admin.email,
        action: suspend ? "user.ban" : "user.unban", targetType: "user", targetId: userId,
        summary: `${suspend ? "Suspended" : "Reinstated"} account${reason ? ` — ${reason}` : ""}`,
      });
      return { kind: "changed" as const, email: account.email, emailVerified: !!account.emailVerifiedAt, now };
    });
    if (result.kind === "not_found") return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (result.kind === "closed") return NextResponse.json({ error: "This account is closed." }, { status: 409 });
    if (result.kind === "administrator") return NextResponse.json({ error: "Administrator accounts cannot be suspended here." }, { status: 403 });
    if (result.kind === "unchanged") return NextResponse.json({ ok: true, changed: false, suspended: suspend });
    if (suspend && result.emailVerified) {
      scheduleAdminBanEmail({ to: result.email, when: result.now, reason, bannedBy: admin.email });
    }
    return NextResponse.json({ ok: true, changed: true, suspended: suspend,
      message: suspend ? "Account suspended. Sessions were revoked and active schedules paused. Any email notice is best effort." : "Account reinstated. Previously paused schedules remain paused." });
  } catch {
    logger.error("Account suspension update failed", { userId, operation: suspend ? "suspend" : "reinstate" });
    return NextResponse.json({ error: "Unable to update the account. Check its current status before trying again." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return change(request, params, true);
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return change(request, params, false);
}
