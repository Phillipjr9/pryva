import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/bulk  { items: [{ productSlug, quantity }] }
 *
 * Bulk ordering has no supplier path yet, so it fails closed: nothing is
 * reserved upstream and nothing is debited from the wallet. The endpoint stays
 * mounted so the dashboard receives an actionable 503 rather than a 404, and so
 * re-enabling bulk means adding real fulfilment here — not removing a gate.
 */
export async function POST() {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Bulk purchases are not available yet." },
    { status: 503 },
  );
}
