import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/digital/purchase
 *
 * No account provider is connected for digital subscriptions, so this fails
 * closed in every environment. A placeholder delivery must never debit a real
 * wallet; the endpoint stays mounted so callers get an actionable 503 rather
 * than a 404.
 */
export async function POST() {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Digital purchases are not available yet." },
    { status: 503 },
  );
}
