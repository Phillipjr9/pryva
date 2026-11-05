import { NextRequest, NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/identity/auth";
import {
  issueEmailVerification,
  rateLimitEmailVerification,
} from "@/lib/identity/email-verification";
import { isSameOriginMutation } from "@/lib/platform/net";
import { resendConfigured } from "@/lib/email/resend-config";
import { scheduleOnboardingEmails } from "@/lib/email/onboarding-emails";

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
      /*
       * Already verified, so there is no link to send -- but this is also the one
       * screen an unverified-looking customer returns to, which makes it the
       * cheapest place to repair a sequence that never finished. Somebody whose
       * receipt and welcome were lost to an outage or a missing table ends up
       * here asking why they cannot withdraw; pressing the button now posts the
       * two missing emails instead of a dead end.
       *
       * Duplicates are impossible: the send is keyed on `(user_id, kind)` with a
       * unique index, so an account that already has both gets nothing at all.
       * Scheduled after the response for the same reason the confirm route does.
       */
      scheduleOnboardingEmails(user.id);
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    // This route is authenticated, so unlike the password-reset endpoint it can
    // say plainly what is wrong instead of answering identically for everyone --
    // there is no address to enumerate here. Answering ok would leave a signed-in
    // user waiting on a link that was never queued, and this is the only in-app
    // path that re-requests one.
    if (!resendConfigured()) {
      return NextResponse.json(
        { error: "Email confirmations are unavailable right now. Please try later or contact support." },
        { status: 503 },
      );
    }

    const delivery = await issueEmailVerification(user.id, user.email, user.name);
    if (!delivery.delivered) {
      // Acceptance is not confirmed. The detailed reason is logged by the mail
      // service, but must not be copied into the customer's response.
      return NextResponse.json(
        {
          error: "We couldn't confirm that the verification email was sent. Check your inbox; if nothing arrives, try again or contact support.",
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
