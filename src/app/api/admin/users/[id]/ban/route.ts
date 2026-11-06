import { createHash, randomBytes } from "node:crypto";
import { isVercelPreview } from "@/lib/platform/financial-environment";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { recordAdminAction } from "@/lib/admin/admin-audit";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminBans, users } from "@/db/schema";
import { logger } from "@/lib/platform/logger";
import { isSameOriginMutation } from "@/lib/platform/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";
import { scheduleAdminBanEmail, type AdminBanNotice } from "@/lib/email/admin-ban-email";

export const dynamic = "force-dynamic";

const BAN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * POST /api/admin/users/[id]/ban
 *
 * An operator requests that an account be closed. The closure does not take
 * effect immediately: a single-use confirmation link is mailed to the account's
 * address, and only when that link is clicked is the account closed. This is the
 * operator-initiated counterpart to self-service account closure — the row stays
 * (orders, ledger, withdrawals, fraud signals are retained) and the identity is
 * scrubbed once confirmed.
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

  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  const admin = access.user;

  const { id: userId } = await params;

  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { reason } = body as { reason?: unknown };
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 200)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }

  // The account must exist and not already be closed.
  const [account] = await db
    .select({ id: users.id, email: users.email, name: users.name, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (account.deletedAt) {
    return NextResponse.json({ error: "This account is already closed." }, { status: 409 });
  }

  // One pending ban per account at a time. A second request supersedes the first
  // rather than leaving two outstanding confirmation links.
  await db.delete(adminBans).where(eq(adminBans.userId, userId));

  // Single-use token: only the SHA-256 hash is stored, so reading the table
  // never yields a usable confirmation link.
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + BAN_TOKEN_TTL_MS);

  const [ban] = await db
    .insert(adminBans)
    .values({
      userId,
      adminId: admin.id,
      adminEmail: admin.email,
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
      tokenHash,
      expiresAt,
    })
    .returning();

  // The confirmation link goes through a route handler that carries the raw
  // token; the hash stored here can never be turned back into one.
  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host") ?? "";
  const proto = (await headers()).get("x-forwarded-proto") ?? "https";
  const confirmUrl = `${proto === "https" ? "https" : "http"}://${host}/api/admin/users/${userId}/ban/confirm?token=${token}`;

  // Schedule the confirmation email to the account's address. Best effort: the
  // ban request remains pending even if mail cannot be sent.
  const notice: AdminBanNotice = {
    to: account.email,
    when: new Date(),
    confirmUrl,
    reason: ban.reason,
    bannedBy: admin.email,
  };
  try {
    scheduleAdminBanEmail(notice);
  } catch {
    logger.warn("Admin ban notice could not be scheduled");
  }

  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "user.ban",
    targetType: "user",
    targetId: userId,
    summary: `Requested account closure for ${account.email}` + (ban.reason ? ` — ${ban.reason}` : ""),
  });

  logger.info("Admin requested account closure", { adminId: admin.id, userId, reason: ban.reason });

  return NextResponse.json({
    ok: true,
    message: "A confirmation link has been emailed to the account. The account will close when the link is clicked.",
    banId: ban.id,
    expiresAt: ban.expiresAt.toISOString(),
  });
}
