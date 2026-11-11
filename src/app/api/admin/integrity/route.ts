import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { runFullIntegrityCheck } from "@/lib/payments/payment-integrity";
import { logger } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    const scope = (request.nextUrl.searchParams.get("scope") ?? "all").trim().toLowerCase();
    if (scope !== "all" && scope !== "wallet" && scope !== "orders") {
      return NextResponse.json({ ok: false, error: "Unsupported integrity scope" }, { status: 400 });
    }

    // The scope decides what is read, not just what is shown: the half that was
    // not asked for is reported as zero checked because it was not run.
    const summary = await runFullIntegrityCheck(scope);

    return NextResponse.json({
      ok: true,
      scope,
      summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Admin integrity check failed", { error });
    return NextResponse.json({ ok: false, error: "Failed to run the integrity check" }, { status: 500 });
  }
}
