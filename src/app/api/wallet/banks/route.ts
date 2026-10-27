import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isPaystackConfigured, getBanks } from "@/lib/paystack";
import { FALLBACK_BANKS, type Bank } from "@/lib/banks";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Cache the live list for an hour — bank codes don't change often. */
let cache: { banks: Bank[]; fetchedAt: number; source: "live" | "fallback" } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * GET /api/wallet/banks — bank picker source for the withdrawal form.
 *
 * Never fails: without a Paystack key, or if Paystack is unreachable, we serve a
 * snapshot of the Nigerian bank list instead of 500ing. An empty picker made the
 * whole withdrawal screen unusable.
 */
export async function GET(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, banks: cache.banks, count: cache.banks.length, source: cache.source });
  }

  if (isPaystackConfigured()) {
    try {
      const banks = await getBanks();
      if (banks.length > 0) {
        const sorted = [...banks].sort((a, b) => a.name.localeCompare(b.name));
        cache = { banks: sorted, fetchedAt: Date.now(), source: "live" };
        return NextResponse.json({ ok: true, banks: sorted, count: sorted.length, source: "live" });
      }
      logger.warn("Bank list came back empty — using the bundled list");
    } catch (error) {
      logger.warn("Bank list fetch failed — using the bundled list", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  cache = { banks: FALLBACK_BANKS, fetchedAt: Date.now(), source: "fallback" };
  return NextResponse.json({
    ok: true,
    banks: FALLBACK_BANKS,
    count: FALLBACK_BANKS.length,
    source: "fallback",
  });
}
