import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { isClubkonnectConfigured, listClubkonnectPlans } from "@/lib/providers/clubkonnect";
import { readSharedSnapshot } from "@/lib/platform/shared-snapshot";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!isClubkonnectConfigured()) {
    return NextResponse.json({ error: "Mobile data supplier credentials are not configured." }, { status: 503, headers });
  }
  const limit = await catalogRateLimiter(`clubkonnect:plans:${user.id}`);
  if (!limit.allowed || limit.unavailable) return NextResponse.json({ error: "Please try again shortly." }, { status: limit.unavailable ? 503 : 429, headers });
  try {
    // Scope snapshots by supplier account, without storing the account ID as a key.
    const account = createHash("sha256").update(process.env.CLUBKONNECT_USER_ID!.trim()).digest("hex").slice(0, 24);
    const snapshot = await readSharedSnapshot({
      key: `clubkonnect:data:v1:${account}`,
      ttlMs: 60_000,
      refresh: async () => ({ value: await listClubkonnectPlans(), checkedAt: new Date().toISOString() }),
    });
    const age = Date.now() - Date.parse(snapshot.refreshedAt);
    if (!Number.isFinite(age) || age < -60_000 || age > 30 * 60_000) {
      return NextResponse.json({ error: "The supplier snapshot has expired. Please retry shortly." }, { status: 503, headers });
    }
    return NextResponse.json({
      plans: snapshot.value,
      checkedAt: snapshot.refreshedAt,
      stale: snapshot.stale,
      priceKind: "supplier-published",
      checkoutAvailable: false,
      checkoutReason: "Purchase and delivery tracking are being connected. No wallet charge is available from this catalogue yet.",
    }, { headers });
  } catch {
    return NextResponse.json({ error: "The mobile data catalogue could not be loaded. Please retry." }, { status: 503, headers });
  }
}
