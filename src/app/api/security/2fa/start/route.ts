import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { logger } from "@/lib/logger";
import { beginEnrolment, getEnrolment, twoFactorAvailable } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

/**
 * Start (or restart) TOTP enrolment and return the secret once.
 *
 * The secret is shown here and never again: it is encrypted at rest, so this is
 * the only opportunity to add it to an authenticator. Restarting replaces an
 * unfinished enrolment; it can never replace an enabled one, because disabling
 * 2FA must be an explicit authenticated action.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

  if (!twoFactorAvailable()) {
    return NextResponse.json(
      { error: "Two-factor authentication is not configured on this deployment." },
      { status: 503 },
    );
  }

  try {
    const enrolment = await getEnrolment(user.id);
    if (enrolment?.enabledAt) {
      return NextResponse.json(
        { error: "Two-factor authentication is already on. Turn it off first to replace the device." },
        { status: 409 },
      );
    }

    const started = await beginEnrolment(user.id, user.email);
    if (!started.ok) {
      return NextResponse.json(
        { error: "Two-factor authentication is already on. Turn it off first to replace the device." },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, secret: started.secret, uri: started.uri });
  } catch (error) {
    logger.error("Failed to start two-factor enrolment", { userId: user.id, error });
    return NextResponse.json({ error: "Could not start enrolment. Please try again." }, { status: 500 });
  }
}
