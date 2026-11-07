import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { isPaystackConfigured, getBanks } from "@/lib/payments/paystack";
import { FALLBACK_BANKS, type Bank } from "@/lib/payments/banks";
import { logger } from "@/lib/platform/logger";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { accountReadRateLimiter, rateLimitRefusal } from "@/lib/platform/rate-limit";

export const dynamic = "force-dynamic";

/** Cache the live list for an hour — bank codes don't change often. */
let cache: { banks: Bank[]; fetchedAt: number; source: "live" | "fallback" } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * The stampede guard.
 *
 * `cache` is per instance, and a serverless deployment runs several, so a cold
 * start (or every instance after an hour) means the next caller pays for a
 * Paystack round trip with the secret key. Without a gate, a burst arriving on
 * a cold instance fans out into one upstream call per request — the app
 * amplifying its own traffic against a provider that bills and rate-limits by
 * request. The first caller fetches; everyone who arrives while that is in
 * flight awaits the same promise.
 */
let inFlight: Promise<Bank[] | null> | null = null;

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

  // A withdrawal form does not need the bank directory more than twice a minute,
  // and this endpoint is the only authenticated read that reaches out to the
  // payment provider. Throttled before the fetch, not after, so a refused caller
  // never spends a Paystack request.
  const throttle = await accountReadRateLimiter(`wallet-banks:${user.id}`);
  const refused = rateLimitRefusal(throttle, "You are loading the bank list too quickly. Please wait a moment.");
  if (refused) return refused;

  if (!isPreviewDatabase() && isPaystackConfigured()) {
    try {
      inFlight ??= getBanks()
        .then((banks) => {
          if (banks.length === 0) {
            logger.warn("Bank list came back empty — using the bundled list");
            return null;
          }
          return [...banks].sort((a, b) => a.name.localeCompare(b.name));
        })
        .catch((error: unknown) => {
          logger.warn("Bank list fetch failed — using the bundled list", {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
        .finally(() => {
          inFlight = null;
        });

      const fetched = await inFlight;
      if (fetched) {
        cache = { banks: fetched, fetchedAt: Date.now(), source: "live" };
        return NextResponse.json({ ok: true, banks: fetched, count: fetched.length, source: "live" });
      }
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
