import { NextRequest } from "next/server";
import { confirmEmailChange } from "@/lib/email-change";
import { isSameOriginMutation } from "@/lib/net";
import { authRateLimiter } from "@/lib/rate-limit";
import { sendSecurityNotice } from "@/lib/security-notice";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/confirm-email-change — finish a change of sign-in address.
 *
 * The click proves control of the new address. The notice goes to the address
 * being *replaced*, because that inbox is the only place the real owner can
 * still hear about it once the change lands.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied" }, { status: 403 });
  }

  const limit = await authRateLimiter("confirm-email-change");
  if (limit.unavailable) return Response.json({ ok: false, error: "Temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const token = body && typeof body === "object" && !Array.isArray(body) ? (body as { token?: unknown }).token : undefined;
  if (typeof token !== "string") return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });

  const result = await confirmEmailChange(token);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });

  // Best effort: the change already landed, and a mail outage must not undo it.
  try {
    await sendSecurityNotice({ to: result.previousEmail, name: "", event: "email_changed" });
  } catch {
    // sendSecurityNotice is already non-throwing; this is the belt to its braces.
  }

  return Response.json({ ok: true, email: result.email });
}
