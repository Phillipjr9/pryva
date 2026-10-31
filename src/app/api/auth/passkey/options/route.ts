import { NextResponse } from "next/server";

import { beginAuthentication, relyingPartyFor } from "@/lib/passkeys";
import { isSameOriginMutation } from "@/lib/net";
import { logger } from "@/lib/logger";
import { passkeyRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/auth-rate-limit";

export const dynamic = "force-dynamic";

/**
 * Step one of a passkey sign-in: hand the browser a challenge to sign.
 *
 * Username-less on purpose — no address is asked for, so this endpoint cannot be
 * used to discover which addresses have accounts. The authenticator offers
 * whichever passkey it holds for this site, and the credential id it returns is
 * looked up server-side on the way back.
 */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const limit = await passkeyRateLimiter(`passkey-options:${clientIp(request)}`);
  if (limit.unavailable) {
    return NextResponse.json({ error: "Passkey sign-in is temporarily unavailable." }, { status: 503 });
  }
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  const rp = relyingPartyFor(request);
  if (!rp) {
    return NextResponse.json({ error: "Passkeys are not available on this address." }, { status: 503 });
  }

  try {
    const started = await beginAuthentication(rp);
    if (!started.ok) {
      return NextResponse.json({ error: "Passkey sign-in is temporarily unavailable." }, { status: 503 });
    }
    // The options carry the challenge, which is also the only reason a browser
    // needs this response: nothing here may be cached.
    return NextResponse.json({ ok: true, options: started.options }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logger.error("Failed to start a passkey sign-in", { error });
    return NextResponse.json({ error: "Passkey sign-in is temporarily unavailable." }, { status: 503 });
  }
}
