import { NextRequest, NextResponse } from "next/server";
import { checkGiftCardBalance } from "@/lib/gift-cards";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { giftCardAttemptLimit, normalizeGiftCardCode } from "@/lib/gift-card-requests";

export const dynamic = "force-dynamic";

/** Never put a bearer gift-card code in a URL, browser history, or access log. */
export async function GET() {
  return NextResponse.json({ error: "Use an authenticated JSON POST to check a gift card." }, {
    status: 405, headers: { Allow: "POST", "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    const limited = await giftCardAttemptLimit(request, user.id);
    if (limited) return limited;
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const code = body && typeof body === "object" && !Array.isArray(body) ? normalizeGiftCardCode((body as { code?: unknown }).code) : null;
    if (!code) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    const result = await checkGiftCardBalance(code);
    if (!result) return NextResponse.json({ error: "Gift card not found" }, { status: 404 });
    return NextResponse.json({ ok: true, amount: result.amount, status: result.status, expiresAt: result.expiresAt.toISOString() }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    console.error("Gift card check failed");
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
