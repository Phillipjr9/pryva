import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isFleexaConfigured } from "@/lib/fleexa";
import { readSupplierSnapshot, supplierItemsForCountry } from "@/lib/fleexa-catalog";
import { isSmmPanelConfigured } from "@/lib/smm-panel";
import { boostItems, readBoostSnapshot } from "@/lib/smm-catalog";
import { isBitcallConfigured } from "@/lib/bitcall";
import { esimItemsForCountry, readEsimSnapshot } from "@/lib/bitcall-esim-catalog";
import { explorerCountry } from "@/lib/service-explorer";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A configured supplier that returned nothing, versus one that is not configured at all. */
type Source<T> = { configured: boolean; snapshot: T | null };

async function attempt<T>(configured: boolean, read: () => Promise<T>): Promise<Source<T>> {
  if (!configured) return { configured: false, snapshot: null };
  try {
    return { configured: true, snapshot: await read() };
  } catch {
    return { configured: true, snapshot: null };
  }
}

/**
 * Read-only catalog. Live purchases remain disabled until mappings, pricing and
 * reconciliation are verified.
 *
 * Each supplier is attempted independently. A deployment with only one key
 * configured must still serve that supplier's listings, so one supplier being
 * absent or unreachable degrades the response instead of failing it; only when
 * every configured supplier fails is the catalog unavailable.
 */
export async function GET(request: NextRequest) {
  if (isPreviewDatabase()) return NextResponse.json({ error: "Live catalog unavailable" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const country = explorerCountry(request.nextUrl.searchParams.get("country"));
  if (!country) return NextResponse.json({ error: "Choose a valid country" }, { status: 400 });
  const limit = await purchaseRateLimiter(`supplier-catalog:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Catalog temporarily unavailable" }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Please try again shortly" }, { status: 429 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const [supplier, boost, esim] = await Promise.all([
    attempt(isFleexaConfigured(), () => readSupplierSnapshot(refresh)),
    attempt(isSmmPanelConfigured(), () => readBoostSnapshot(refresh)),
    attempt(isBitcallConfigured(), () => readEsimSnapshot(refresh)),
  ]);
  const sources = [supplier, boost, esim];
  if (sources.every((source) => !source.snapshot)) {
    return NextResponse.json({ error: "The live catalog is temporarily unavailable" }, { status: 503 });
  }

  const items = [
    ...(supplier.snapshot ? supplierItemsForCountry(supplier.snapshot, country.code) : []),
    ...(esim.snapshot ? esimItemsForCountry(esim.snapshot, country.code) : []),
    ...(boost.snapshot ? boostItems(boost.snapshot) : []),
  ];
  // Partial means "this may be incomplete": a configured source that failed, or
  // one that reported its own degraded read. A source that is simply not
  // configured is the steady state, not a warning.
  const partial = sources.some((source) => source.snapshot?.partial === true || (source.configured && !source.snapshot));
  const fetchedAt = sources
    .map((source) => source.snapshot?.fetchedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .pop() ?? null;

  return NextResponse.json(
    { ok: true, country: country.code, partial, fetchedAt, items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
