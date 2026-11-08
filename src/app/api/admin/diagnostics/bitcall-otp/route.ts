import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/identity/auth";
import { BitcallError, inspectBitcallOtpCatalog } from "@/lib/providers/bitcall";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/diagnostics/bitcall-otp
 * Admin-session-only, read-only summary of the live OTP catalog response.
 * The response is deliberately limited to structure and counts; never return
 * upstream values, request headers, or credentials from this diagnostic.
 */
export async function GET() {
  await requireAdmin("/admin/stock");

  try {
    const diagnostics = await inspectBitcallOtpCatalog();
    return NextResponse.json(
      { ok: true, diagnostics },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Provider messages are intentionally not returned; the code/status and
    // request ID are enough to distinguish local configuration from an upstream
    // refusal without exposing any credential or untrusted body content.
    const safeError = error instanceof BitcallError
      ? { code: error.code, status: error.status, requestId: error.requestId }
      : { code: "UNEXPECTED_ERROR", status: 500, requestId: null };
    return NextResponse.json(
      { ok: false, error: safeError },
      { status: safeError.status >= 400 && safeError.status < 600 ? safeError.status : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
