import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { finishRegistration, listCredentialSummaries, relyingPartyFor } from "@/lib/passkeys";
import { passkeyRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/**
 * Finish adding a passkey.
 *
 * The label the customer typed is trimmed and bounded here rather than trusted;
 * it is a display string in a settings list, nothing more.
 */
export async function POST(request: Request) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

  const limit = await passkeyRateLimiter(`passkey-register:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Passkeys are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a moment." }, { status: 429 });

  const rp = relyingPartyFor(request);
  if (!rp) return NextResponse.json({ error: "Passkeys are not available on this address." }, { status: 503 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 32_768);
  } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const { response, label } = (body ?? {}) as { response?: unknown; label?: unknown };
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  }
  if (label !== undefined && typeof label !== "string") {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  try {
    const result = await finishRegistration({
      userId: user.id,
      rp,
      response: response as RegistrationResponseJSON,
      label: typeof label === "string" ? label : null,
    });

    if (!result.ok) {
      const message =
        result.reason === "duplicate"
          ? "That device is already a passkey on an account. Use a different one, or sign in with it."
          : "That passkey could not be confirmed. Please try again.";
      return NextResponse.json({ error: message }, { status: result.reason === "duplicate" ? 409 : 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        credential: { deviceType: result.deviceType, backedUp: result.backedUp },
        passkeys: await listCredentialSummaries(user.id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Failed to store a passkey", { userId: user.id, error });
    return NextResponse.json({ error: "Could not save that passkey. Please try again." }, { status: 500 });
  }
}
