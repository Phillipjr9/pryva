import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/proxies/purchase
 *
 * Proxy fulfilment is not yet wired to a supplier endpoint, so this fails
 * closed: nothing is reserved and no wallet is debited. The endpoint stays
 * mounted so callers receive an actionable 503 instead of a 404, and so
 * enabling proxies means adding real fulfilment here rather than removing a
 * gate.
 */
export async function POST() {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Proxy purchases are not available yet." },
    { status: 503 },
  );
}
