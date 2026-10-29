import { NextRequest, NextResponse } from "next/server";

import {
  confirmEmailVerification,
  rateLimitEmailVerification,
} from "@/lib/email-verification";
import { isSameOriginMutation } from "@/lib/net";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/**
 * Redeem a confirmation token. Deliberately unauthenticated: the link arrives by
 * email and may be opened in a browser with no session, so requiring one would
 * make the email useless on any device other than the one that signed up.
 *
 * The token is the credential. It is 256 bits, single use, hashed at rest, and
 * expires in 24 hours.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const throttle = await rateLimitEmailVerification(`verify-confirm:${ip}`);
    if (throttle.unavailable) {
      return NextResponse.json(
        { error: "Temporarily unavailable. Try again shortly." },
        { status: 503 },
      );
    }
    if (!throttle.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 8_192);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { token } = body as { token?: unknown };
    if (typeof token !== "string") {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const result = await confirmEmailVerification(token);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth] verification confirm failed", error);
    return NextResponse.json(
      { error: "Could not confirm that link. Try again shortly." },
      { status: 500 },
    );
  }
}
