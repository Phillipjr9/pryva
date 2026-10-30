import type { NextRequest } from "next/server";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { clientIp } from "@/lib/auth-rate-limit";
import { GENERIC_REQUEST_MESSAGE, rateLimitPasswordReset, requestPasswordReset } from "@/lib/password-reset";
import { resendConfigured } from "@/lib/resend-config";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const fields = (body ?? {}) as { email?: unknown };
  if (typeof fields.email !== "string" || !fields.email.trim()) {
    return Response.json({ ok: false, error: "Enter your email address." }, { status: 400 });
  }

  // Without a mail provider nothing can be delivered, so this endpoint must not
  // answer `ok: true`: that reads as "check your inbox" and the inbox stays
  // empty forever. Checked before the rate limiter and before a reset token is
  // written, so an unfulfillable request spends no shared budget and leaves no
  // undeliverable token behind.
  //
  // The status and wording deliberately match the rate-limit outage response
  // below. Both are operator-side failures, identical for every address, so
  // neither reveals whether the address has an account -- the property the
  // GENERIC_REQUEST_MESSAGE at the end of this handler exists to preserve.
  if (!resendConfigured()) {
    return Response.json({ ok: false, error: "Password resets are temporarily unavailable." }, { status: 503 });
  }

  const limit = await rateLimitPasswordReset(`forgot:${clientIp(request)}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Password resets are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  await requestPasswordReset(fields.email);
  // The same answer either way: a different response for an unknown address
  // would turn this endpoint into a directory of who has an account.
  return Response.json({ ok: true, message: GENERIC_REQUEST_MESSAGE });
}
