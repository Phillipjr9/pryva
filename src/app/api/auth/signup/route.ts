import { eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, isValidEmail, normalizeEmail } from "@/lib/auth";
import { creditWallet } from "@/lib/wallet";
import { DEMO_EMAIL } from "@/lib/demo-account";

const WELCOME_CREDIT = 5000;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasDatabase) {
    return Response.json(
      { ok: false, error: "Account creation is disabled in this database-free preview. You can use the Pryva demo account instead." },
      { status: 503 },
    );
  }

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
    if (email === DEMO_EMAIL) {
      return Response.json({ ok: false, error: "That email is reserved for the Pryva demo account." }, { status: 409 });
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

    await creditWallet({
      userId: created.id,
      amount: WELCOME_CREDIT,
      type: "credit",
      description: "Welcome credit — try Pryva",
    });

    await createSession(created.id, request);

    return Response.json({ ok: true, welcomeCredit: WELCOME_CREDIT });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
