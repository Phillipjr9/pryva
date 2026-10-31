import { NextRequest, NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import {
  issueEmailVerification,
  rateLimitEmailVerification,
} from "@/lib/email-verification";
import { isSameOriginMutation } from "@/lib/net";
import { resendConfigured } from "@/lib/resend-config";

export const dynamic = "force-dynamic";

/**
 * Resend the confirmation link for the signed-in account.
 *
 * The caller is already identified, so there is no address to enumerate: this
 * route can say plainly whether a link was sent, unlike the password reset
 * endpoint which must answer identically for known and unknown addresses.
 *
 * "Sent" is now a claim the route can stand behind. It used to answer ok as soon
 * as a token was stored, even when the mail provider had refused the message —
 * the provider's answer was never read. A person pressing "Email me a link" got a
 * success, waited, and received nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    }

    // Per account: an authenticated route has a better identity than an IP, and a
    // shared NAT would let one user exhaust another's allowance.
    const throttle = await rateLimitEmailVerification(`verify:${user.id}`);
    if (throttle.unavailable) {
      return NextResponse.json(
        { error: "Temporarily unavailable. Try again shortly." },
        { status: 503 },
      );
    }
    if (!throttle.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    if (user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    // This route is authenticated, so unlike the password-reset endpoint it can
    // say plainly what is wrong instead of answering identically for everyone --
    // there is no address to enumerate here. Answering ok would leave a signed-in
    // user waiting on a link that was never queued, and this is the only in-app
    // path that re-requests one.
    if (!resendConfigured()) {
      return NextResponse.json(
        { error: "Email delivery is not configured on this server, so the link cannot be sent." },
        { status: 503 },
      );
    }

    const delivery = await issueEmailVerification(user.id, user.email, user.name);
    if (!delivery.delivered) {
      // The link exists and is valid, but nothing was delivered. Answering ok here
      // is what made the button look like it did nothing: the person waited for a
      // message the provider had already refused.
      return NextResponse.json(
        {
          error: `A new link was created, but ${delivery.detail ?? "the mail service refused the message"}. Nothing will arrive until that is fixed.`,
          delivered: false,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, delivered: true });
  } catch (error) {
    console.error("[auth] verification request failed", error);
    return NextResponse.json(
      { error: "Could not send that email. Try again shortly." },
      { status: 500 },
    );
  }
}
