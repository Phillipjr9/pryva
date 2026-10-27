import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, isConfiguredAdminEmail, isValidEmail, normalizeEmail } from "@/lib/auth";
import { creditWallet } from "@/lib/wallet";
import { isDemoEmail, isPreviewDatabase, PREVIEW_WELCOME_CREDIT } from "@/lib/demo-policy";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };

    const name = (body.name ?? "").trim();
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (name.length < 2) {
      return Response.json({ ok: false, error: "Please enter your full name." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return Response.json({ ok: false, error: "That email doesn't look right." }, { status: 400 });
    }
    if (isConfiguredAdminEmail(email) || isDemoEmail(email)) {
      return Response.json({ ok: false, error: "This account cannot be created through public signup." }, { status: 403 });
    }
    if (password.length < 8) {
      return Response.json(
        { ok: false, error: "Use at least 8 characters for your password." },
        { status: 400 },
      );
    }

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return Response.json(
        { ok: false, error: "An account with this email already exists. Try signing in." },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(users)
      .values({ name, email, passwordHash: hashPassword(password), walletBalance: 0 })
      .returning({ id: users.id });

    if (!created) {
      return Response.json({ ok: false, error: "Could not create that account." }, { status: 500 });
    }

    const welcomeCredit = isPreviewDatabase() ? PREVIEW_WELCOME_CREDIT : 0;
    if (welcomeCredit > 0) {
      await creditWallet({
        userId: created.id,
        amount: welcomeCredit,
        type: "credit",
        description: "Preview welcome credit",
      });
    }

    await createSession(created.id, request);

    return Response.json({ ok: true, welcomeCredit });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
