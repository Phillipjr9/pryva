import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuthApi, verifyPassword } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";
import { disableTwoFactor, twoFactorAvailable, verifySecondFactor } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

/**
 * Turn 2FA off. Requires the password **and** a current code (or a recovery
 * code): a stolen session alone must not be able to remove the second factor,
 * and neither must a password alone.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

  if (!twoFactorAvailable()) {
    // If the key is gone, an enabled second factor cannot be verified. Fail
    // closed and route the customer through support rather than removing it on a
    // password alone.
    return NextResponse.json(
      { error: "Two-factor authentication is not configured on this deployment. Contact support." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 4_096);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { password, code } = body as { password?: unknown; code?: unknown };
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  try {
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!row || !verifyPassword(password, row.passwordHash)) {
      return NextResponse.json({ error: "That password is not correct." }, { status: 401 });
    }

    const second = await verifySecondFactor(user.id, code);
    if (!second.ok) {
      return NextResponse.json(
        {
          error:
            second.reason === "not-enabled"
              ? "Two-factor authentication is not on for this account."
              : "That code did not match.",
        },
        { status: second.reason === "unavailable" ? 503 : 400 },
      );
    }

    await disableTwoFactor(user.id);
    logger.info("Two-factor authentication disabled", { userId: user.id, method: second.method });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to disable two-factor authentication", { userId: user.id, error });
    return NextResponse.json({ error: "Could not turn off two-factor authentication." }, { status: 500 });
  }
}
