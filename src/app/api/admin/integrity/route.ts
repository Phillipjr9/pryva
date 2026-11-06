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

    const summary = await runFullIntegrityCheck();
    const filtered = {
      users: scope === "orders" ? { checked: 0, issues: 0 } : summary.users,
      orders: scope === "wallet" ? { checked: 0, issues: 0 } : summary.orders,
    };

    return NextResponse.json({
      ok: true,
      scope,
      summary: filtered,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Admin integrity check failed", { error });
    return NextResponse.json({ ok: false, error: "Failed to run the integrity check" }, { status: 500 });
  }
}
