import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, isConfiguredAdminEmail, isValidEmail, normalizeEmail } from "@/lib/auth";
import { creditWallet } from "@/lib/wallet";
import { isDemoEmail, isPreviewDatabase, PREVIEW_WELCOME_CREDIT } from "@/lib/demo-policy";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
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
    const fields = body as { name?: unknown; email?: unknown; password?: unknown };
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    const email = typeof fields.email === "string" ? normalizeEmail(fields.email) : "";
    const password = typeof fields.password === "string" ? fields.password : "";

    const limited = await checkAuthRateLimit(request, "signup");
    if (limited) return limited;
    if (name.length < 2 || name.length > 120) {
      return Response.json({ ok: false, error: "Enter a name between 2 and 120 characters." }, { status: 400 });
    }
    if (email.length > 200 || !isValidEmail(email)) {
      return Response.json({ ok: false, error: "That email doesn't look right." }, { status: 400 });
    }
    if (isConfiguredAdminEmail(email) || isDemoEmail(email)) {
      return Response.json({ ok: false, error: "This account cannot be created through public signup." }, { status: 403 });
    }
    if (password.length < 8 || password.length > 128) {
      return Response.json({ ok: false, error: "Use a password between 8 and 128 characters." }, { status: 400 });
    }

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return Response.json({ ok: false, error: "An account with this email already exists. Try signing in." }, { status: 409 });
    }

    const [created] = await db.insert(users)
      .values({ name, email, passwordHash: hashPassword(password), walletBalance: 0 })
      .returning({ id: users.id });
    if (!created) return Response.json({ ok: false, error: "Could not create that account." }, { status: 500 });

    const welcomeCredit = isPreviewDatabase() ? PREVIEW_WELCOME_CREDIT : 0;
    if (welcomeCredit > 0) {
      await creditWallet({ userId: created.id, amount: welcomeCredit, type: "credit", description: "Preview welcome credit" });
    }
    await createSession(created.id, request);
    return Response.json({ ok: true, welcomeCredit });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
