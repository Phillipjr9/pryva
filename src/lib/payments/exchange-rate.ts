/**
 * USD → NGN rate with caching and a legacy fallback.
 *
 * Why this exists: the marketplace is priced in USD, Pryva sells in Naira, and
 * nobody wants to edit a constant every morning. Resolution order:
 *
 *   1. USD_NGN_RATE env override  (manual pin, wins while set)
 *   2. Cached authenticated rate  (1 hour)
 *   3. Authenticated provider, when EXCHANGE_RATE_API_KEY is configured
 *   4. USD_NGN_FALLBACK env, else 1600
 *
 * The public no-key feeds are intentionally not used: their attribution
 * requirement is incompatible with removing the credit from the storefront.
 *
 * Legacy USD consumers fall back and log when lookups fail; the fallback may
 * not match the supplier funding rate. eSIM quotes use the stricter path below.
 */

import "server-only";
import { logger } from "@/lib/platform/logger";
import { authenticatedRateConfigured, clearAuthenticatedRateCache, getAuthenticatedNgnRate } from "@/lib/payments/authenticated-exchange-rate";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATE = Number(process.env.USD_NGN_FALLBACK || 1600);

type Cache = { rate: number; fetchedAt: number; source: "override" | "authenticated" | "fallback" };

let cache: Cache | null = null;
/** De-duplicates concurrent cold-start lookups (a 20-row listing page would
 *  otherwise fire 20 identical provider calls). */
let inFlight: Promise<number | null> | null = null;

function envOverride(): number | null {
  const raw = process.env.USD_NGN_RATE;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fetchAuthenticatedUsdRate(): Promise<number | null> {
  const authenticated = await getAuthenticatedNgnRate("USD");
  return authenticated?.rate ?? null;
}

export type RateInfo = { rate: number; source: Cache["source"]; fetchedAt: string };

/** Current NGN per USD, cached for an hour. */
export async function getUsdToNgnRate(): Promise<RateInfo> {
  const override = envOverride();
  if (override) {
    return { rate: override, source: "override", fetchedAt: new Date().toISOString() };
  }

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rate: cache.rate, source: cache.source, fetchedAt: new Date(cache.fetchedAt).toISOString() };
  }

  if (!inFlight) {
    inFlight = fetchAuthenticatedUsdRate().finally(() => {
      inFlight = null;
    });
  }

  const authenticated = await inFlight;
  if (authenticated !== null) {
    cache = { rate: authenticated, fetchedAt: Date.now(), source: "authenticated" };
    return { rate: authenticated, source: "authenticated", fetchedAt: new Date(cache.fetchedAt).toISOString() };
  }

  cache = { rate: FALLBACK_RATE, fetchedAt: Date.now(), source: "fallback" };
  logger.warn("Using fallback USD→NGN rate", { rate: FALLBACK_RATE });
  return { rate: FALLBACK_RATE, source: "fallback", fetchedAt: new Date(cache.fetchedAt).toISOString() };
}

export function clearRateCache(): void {
  cache = null;
  quoteCache.clear();
  quoteFailureUntil.clear();
  clearAuthenticatedRateCache();
}

/**
 * A purchase-sensitive quote needs a current rate, not the legacy display
 * fallback above. These are the account currencies the eSIM catalog supports.
 * An operator can pin their actual funding rate; otherwise use the configured
 * authenticated source, validating its base and publication time.
 */
export type NgnQuoteCurrency = "USD" | "EUR";
export type NgnQuoteRate = { rate: number; source: "override" | "authenticated"; fetchedAt: string };
const QUOTE_RATE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const QUOTE_RATE_FAILURE_TTL_MS = 60 * 1000;
const quoteCache = new Map<NgnQuoteCurrency, { rate: NgnQuoteRate; checkedAt: number }>();
const quoteInFlight = new Map<NgnQuoteCurrency, Promise<NgnQuoteRate | null>>();
const quoteFailureUntil = new Map<NgnQuoteCurrency, number>();

async function fetchFreshNgnRate(currency: NgnQuoteCurrency): Promise<NgnQuoteRate | null> {
  const authenticated = await getAuthenticatedNgnRate(currency);
  if (authenticated) return { rate: authenticated.rate, source: "authenticated", fetchedAt: authenticated.publishedAt };
  if (authenticatedRateConfigured()) logger.warn("Authenticated exchange rate unavailable", { currency });
  return null;
}

/**
 * NGN per unit of the named currency, or null if it cannot be established.
 * No hard-coded or stale fallback is ever used for an eSIM purchase quote.
 */
export async function getFreshNgnRate(currency: NgnQuoteCurrency): Promise<NgnQuoteRate | null> {
  const raw = process.env[`${currency}_NGN_RATE`]?.trim();
  if (raw) {
    const rate = Number(raw);
    return Number.isFinite(rate) && rate > 100
      ? { rate, source: "override", fetchedAt: new Date().toISOString() }
      : null;
  }
  const now = Date.now();
  const cached = quoteCache.get(currency);
  if (cached && now - cached.checkedAt < CACHE_TTL_MS &&
      now - Date.parse(cached.rate.fetchedAt) <= QUOTE_RATE_MAX_AGE_MS) return cached.rate;
  if ((quoteFailureUntil.get(currency) ?? 0) > now) return null;

  let inProgress = quoteInFlight.get(currency);
  if (!inProgress) {
    inProgress = fetchFreshNgnRate(currency).then((rate) => {
      if (rate) {
        quoteCache.set(currency, { rate, checkedAt: Date.now() });
        quoteFailureUntil.delete(currency);
      } else {
        quoteFailureUntil.set(currency, Date.now() + QUOTE_RATE_FAILURE_TTL_MS);
      }
      return rate;
    }).finally(() => { quoteInFlight.delete(currency); });
    quoteInFlight.set(currency, inProgress);
  }
  return inProgress;
}
