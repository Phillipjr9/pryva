import { eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { createSession, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_USER } from "@/lib/demo-account";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (!isValidEmail(email) || password.length === 0) {
      return Response.json(
        { ok: false, error: "Enter your email and password to continue." },
        { status: 400 },
      );
    }

    if (!hasDatabase) {
      if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        return Response.json(
          { ok: false, error: "This preview only supports the Pryva demo account. Use the live demo button or enter its demo credentials." },
          { status: 401 },
        );
      }
      await createSession(DEMO_USER.id, request);
      return Response.json({ ok: true });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return Response.json(
        { ok: false, error: "Those details don't match an account." },
        { status: 401 },
      );
    }

    await createSession(user.id, request);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
