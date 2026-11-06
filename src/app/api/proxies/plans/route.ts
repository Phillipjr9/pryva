import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/proxies/plans
 *
 * The static planning catalogue is not a verified, deliverable offer.
 */
export async function GET() {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Proxy plans are not available yet." },
    { status: 503 },
  );
}
