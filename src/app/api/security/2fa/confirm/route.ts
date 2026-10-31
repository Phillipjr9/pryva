import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";
import { confirmEnrolment, twoFactorAvailable } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

/**
 * Confirm enrolment with a code from the authenticator, and return the recovery
 * codes once.
 *
 * The codes are hashed before storage, so this response is the only time they
 * exist in readable form. Losing them is recoverable only through support, which
 * is why the UI asks the customer to store them before continuing.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

  if (!twoFactorAvailable()) {
    return NextResponse.json(
      { error: "Two-factor authentication is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { code } = body as { code?: unknown };

  try {
    const confirmed = await confirmEnrolment(user.id, code);
    if (!confirmed.ok) {
      return NextResponse.json(
        {
          error:
            confirmed.reason === "no-enrolment"
              ? "Start setup again before confirming."
              : "That code did not match. Check your authenticator and try again.",
        },
        { status: 400 },
      );
    }
    logger.info("Two-factor authentication enabled", { userId: user.id });
    return NextResponse.json({ ok: true, recoveryCodes: confirmed.recoveryCodes });
  } catch (error) {
    logger.error("Failed to confirm two-factor enrolment", { userId: user.id, error });
    return NextResponse.json({ error: "Could not confirm setup. Please try again." }, { status: 500 });
  }
}
