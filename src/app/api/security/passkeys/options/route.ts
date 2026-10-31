import { NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { MAX_PASSKEYS_PER_ACCOUNT, beginRegistration, relyingPartyFor } from "@/lib/passkeys";
import { passkeyRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Start adding a passkey to the signed-in account.
 *
 * Signed in, same origin, rate-limited: enrolling a credential is a way to sign
 * in later, so it is treated as a security change and not as a preference.
 */
export async function POST(request: Request) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

  const limit = await passkeyRateLimiter(`passkey-register:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Passkeys are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a moment." }, { status: 429 });

  const rp = relyingPartyFor(request);
  if (!rp) return NextResponse.json({ error: "Passkeys are not available on this address." }, { status: 503 });

  try {
    const started = await beginRegistration({ userId: user.id, email: user.email, name: user.name, rp });
    if (!started.ok) {
      return NextResponse.json(
        {
          error:
            started.reason === "at-capacity"
              ? `This account already has ${MAX_PASSKEYS_PER_ACCOUNT} passkeys. Remove one before adding another.`
              : "Passkeys are temporarily unavailable.",
        },
        { status: started.reason === "at-capacity" ? 409 : 503 },
      );
    }
    return NextResponse.json({ ok: true, options: started.options }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Failed to start passkey enrolment", { userId: user.id, error });
    return NextResponse.json({ error: "Could not start. Please try again." }, { status: 500 });
  }
}
