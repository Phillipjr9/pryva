import { eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { createSession, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_USER } from "@/lib/demo-account";
import { relativeRedirect } from "@/lib/net";

export const dynamic = "force-dynamic";

function safeNext(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.length > 600
  ) {
    return "/dashboard";
  }

  try {
    const destination = new URL(value, "https://pryva.invalid");
    if (destination.origin !== "https://pryva.invalid") return "/dashboard";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/dashboard";
  }
}

function formRedirect(request: Request, next: string, error?: string): Response {
  if (!error) return relativeRedirect(next, 303);

  const destination = new URL("/login", request.url);
  destination.searchParams.set("error", error);
  if (next !== "/dashboard") destination.searchParams.set("next", next);
  return relativeRedirect(`${destination.pathname}${destination.search}`, 303);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormRequest =
    contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  let next = "/dashboard";

  try {
    let body: { email?: unknown; password?: unknown; next?: unknown };
    if (isFormRequest) {
      const form = await request.formData();
      body = {
        email: form.get("email"),
        password: form.get("password"),
        next: form.get("next"),
      };
      next = safeNext(body.next);
    } else {
      body = (await request.json()) as { email?: unknown; password?: unknown; next?: unknown };
    }

    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const password = typeof body.password === "string" ? body.password : "";

    if (!isValidEmail(email) || password.length === 0) {
      if (isFormRequest) return formRedirect(request, next, "login-invalid");
      return Response.json(
        { ok: false, error: "Enter your email and password to continue." },
        { status: 400 },
      );
    }

    if (email === DEMO_EMAIL) {
      if (password !== DEMO_PASSWORD) {
        if (isFormRequest) return formRedirect(request, next, "login-invalid");
        return Response.json(
          { ok: false, error: "Those details don't match the Pryva demo account." },
          { status: 401 },
        );
      }
      await createSession(DEMO_USER.id, request);
      return isFormRequest ? formRedirect(request, next) : Response.json({ ok: true });
    }

    if (!hasDatabase) {
      if (isFormRequest) return formRedirect(request, next, "demo-only");
      return Response.json(
        {
          ok: false,
          error: "This preview only supports the Pryva demo account. Use the live demo button or enter its demo credentials.",
        },
        { status: 401 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      if (isFormRequest) return formRedirect(request, next, "login-invalid");
      return Response.json({ ok: false, error: "Those details don't match an account." }, { status: 401 });
    }

    await createSession(user.id, request);
    return isFormRequest ? formRedirect(request, next) : Response.json({ ok: true });
  } catch {
    if (isFormRequest) return formRedirect(request, next, "login-failed");
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
