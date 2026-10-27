import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth";
import { isDemoEmail, isPreviewDatabase } from "@/lib/demo-policy";
import { checkAuthRateLimit, clearAuthRateLimit } from "@/lib/auth-rate-limit";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    // Throttle before touching the database so brute force costs us nothing.
    const limited = await checkAuthRateLimit(request, "login", email || undefined);
    if (limited) return limited;

    if (!isValidEmail(email) || password.length === 0 || (isDemoEmail(email) && !isPreviewDatabase())) {
      return Response.json(
        { ok: false, error: "Enter your email and password to continue." },
        { status: 400 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return Response.json(
        { ok: false, error: "Those details don't match an account." },
        { status: 401 },
      );
    }

    clearAuthRateLimit(request, email);
    await createSession(user.id, request);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
