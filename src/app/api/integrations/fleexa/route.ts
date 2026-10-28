import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { getFleexaStatus } from "@/lib/fleexa";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

/** Supplier identity and account connectivity are operator-only. Never call it from the demo. */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  if (isPreviewDatabase()) return NextResponse.json({ ok: true, configured: false, online: false });
  try {
    const { configured, online } = await getFleexaStatus();
    return NextResponse.json({ ok: true, configured, online }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Supplier status unavailable" }, { status: 503 });
  }
}
