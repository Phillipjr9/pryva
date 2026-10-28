import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { readSupplierSnapshot, supplierItemsForCountry } from "@/lib/fleexa-catalog";
import { explorerCountry } from "@/lib/service-explorer";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Read-only catalog. Live purchases remain disabled until mappings and reconciliation are verified. */
export async function GET(request: NextRequest) {
  if (isPreviewDatabase()) return NextResponse.json({ error: "Live catalog unavailable" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const country = explorerCountry(request.nextUrl.searchParams.get("country"));
  if (!country) return NextResponse.json({ error: "Choose a valid country" }, { status: 400 });
  const limit = await purchaseRateLimiter(`supplier-catalog:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Catalog temporarily unavailable" }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Please try again shortly" }, { status: 429 });
  try {
    const snapshot = await readSupplierSnapshot(request.nextUrl.searchParams.get("refresh") === "1");
    return NextResponse.json({ ok: true, country: country.code, partial: snapshot.partial, fetchedAt: snapshot.fetchedAt, items: supplierItemsForCountry(snapshot, country.code) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The live catalog is temporarily unavailable" }, { status: 503 });
  }
}
