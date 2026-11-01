import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { requireAuthApi, hashPassword, verifyPassword, SESSION_COOKIE, SESSION_COOKIE_EMBEDDED } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { passwordChangeRateLimiter } from "@/lib/rate-limit";
import { validatePassword } from "@/lib/validation";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { sendSecurityNotice } from "@/lib/security-notice";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

    // Throttled per account: an authenticated route has a better identity than an
    // IP, and a shared NAT would let one user's traffic exhaust another's allowance.
    const throttle = await passwordChangeRateLimiter(`password:${user.id}`);
    if (throttle.unavailable) {
      return NextResponse.json({ error: "Temporarily unavailable. Try again shortly." }, { status: 503 });
    }
    if (!throttle.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 8_192);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { currentPassword, newPassword } = body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string") {
      return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
    }
    const error = validatePassword(newPassword);
    if (error) return NextResponse.json({ error }, { status: 400 });
    const jar = await cookies();
    const currentToken = jar.get(SESSION_COOKIE)?.value ?? jar.get(SESSION_COOKIE_EMBEDDED)?.value;
    if (!currentToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userProfile = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!userProfile) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!verifyPassword(currentPassword, userProfile.passwordHash)) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const newHash = hashPassword(newPassword);
    const changed = await db.transaction(async (tx) => {
      // Two simultaneous changes must not both succeed against the same old hash.
      const [updated] = await tx.update(users).set({ passwordHash: newHash })
        .where(and(eq(users.id, user.id), eq(users.passwordHash, userProfile.passwordHash)))
        .returning({ id: users.id });
      if (!updated) return false;
      await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.token, currentToken)));
      return true;
    });
    if (!changed) return NextResponse.json({ error: "Password changed elsewhere; sign in again." }, { status: 409 });

    // The account holder is the only one who can tell us this was not an
    // attacker who already had the old password. Best effort by design: the
    // change has committed, and a mail outage must not report it as failed.
    try {
      await sendSecurityNotice({ to: userProfile.email, name: userProfile.name, event: "password_changed" });
    } catch {
      // The password has already changed; a mail failure must not report otherwise.
    }

    return NextResponse.json({ ok: true, message: "Password changed; other sessions were signed out." });
  } catch {
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
