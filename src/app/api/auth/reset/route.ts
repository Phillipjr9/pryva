import type { NextRequest } from "next/server";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { clientIp } from "@/lib/auth-rate-limit";
import { rateLimitPasswordReset, resetPassword } from "@/lib/password-reset";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 4_096);
  } catch (error) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const fields = (body ?? {}) as { token?: unknown; password?: unknown };
  if (typeof fields.token !== "string" || typeof fields.password !== "string") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const limit = await rateLimitPasswordReset(`reset:${clientIp(request)}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Password resets are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  const result = await resetPassword(fields.token, fields.password);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
