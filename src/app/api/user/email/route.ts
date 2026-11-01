import { NextRequest } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { requestEmailChange } from "@/lib/email-change";
import { isSameOriginMutation } from "@/lib/net";
import { authRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/email — ask to change the sign-in address.
 *
 * Nothing changes here. The address only moves when a link sent to it comes
 * back, which is what makes this different from an editable profile field.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied" }, { status: 403 });
  }

  const limit = await authRateLimiter(`email-change:${user.id}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Temporarily unavailable. Try again shortly." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Content-Type must be application/json" }, { status: 415 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 4_096);
  } catch (error) {
    return Response.json(
      { ok: false, error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  const email = body && typeof body === "object" && !Array.isArray(body) ? (body as { email?: unknown }).email : undefined;
  if (typeof email !== "string") return Response.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });

  const result = await requestEmailChange({ userId: user.id, newEmail: email });
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json({ ok: true, message: result.message });
}
