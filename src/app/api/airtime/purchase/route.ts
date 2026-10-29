import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/airtime/purchase
 *
 * Mobile data has no fulfilment path, so this fails closed in every environment:
 * nothing is reserved and no wallet is debited. The endpoint stays mounted so
 * callers receive an actionable 503 instead of a 404, and so enabling data means
 * adding real fulfilment here rather than removing a gate.
 */
export async function POST() {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Data purchases are not available yet." },
    { status: 503 },
  );
}
