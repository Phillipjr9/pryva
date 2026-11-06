import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/airtime/plans
 *
 * Mobile data plans are now a supplier-gated service. The static catalogue is
 * not a verified, deliverable offer until a supplier endpoint is wired up.
 */
export async function GET() {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Data plans are not available yet." },
    { status: 503 },
  );
}
