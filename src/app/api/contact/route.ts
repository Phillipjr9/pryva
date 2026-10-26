import { db, hasDatabase } from "@/db";
import { contactMessages } from "@/db/schema";
import { getCurrentUser, isDemoUser, isValidEmail, normalizeEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!hasDatabase || (user && isDemoUser(user))) {
    return Response.json(
      { ok: false, error: "Messaging is unavailable in the read-only demo. Please email support@pryva.ng." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      topic?: string;
      message?: string;
    };

    const name = (body.name ?? "").trim();
    const email = normalizeEmail(body.email ?? "");
    const topic = (body.topic ?? "General question").trim().slice(0, 80);
    const message = (body.message ?? "").trim();

    if (name.length < 2) {
      return Response.json({ ok: false, error: "Please share your name." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return Response.json({ ok: false, error: "Please check your email address." }, { status: 400 });
    }
    if (message.length < 10) {
      return Response.json(
        { ok: false, error: "A little more detail would help us help you." },
        { status: 400 },
      );
    }

    await db.insert(contactMessages).values({
      userId: user?.id ?? null,
      name,
      email,
      topic,
      message,
    });

    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { ok: false, error: "We couldn't send that message. Please email support@pryva.ng." },
      { status: 500 },
    );
  }
}
