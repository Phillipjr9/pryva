import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth";
import { checkAuthRateLimit, clearAuthRateLimit } from "@/lib/auth-rate-limit";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });
  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 8_192);
  } catch (error) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  try {
    const fields = body as { email?: unknown; password?: unknown };
    const email = typeof fields.email === "string" ? normalizeEmail(fields.email) : "";
    const password = typeof fields.password === "string" ? fields.password : "";
    const limited = await checkAuthRateLimit(request, "login", email.length <= 200 ? email : "");
    if (limited) return limited;

    if (email.length > 200 || !isValidEmail(email) || password.length === 0) {
      return Response.json(
        { ok: false, error: "Enter your email and password to continue." },
        { status: 400 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return Response.json({ ok: false, error: "Those details don't match an account." }, { status: 401 });
    }

    await clearAuthRateLimit(request, email);
    await createSession(user.id, request);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
