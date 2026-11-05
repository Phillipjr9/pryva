/**
 * USD → NGN rate with caching and a safe fallback.
 *
 * Why this exists: the marketplace is priced in USD, Pryva sells in Naira, and
 * nobody wants to edit a constant every morning. Resolution order:
 *
 *   1. USD_NGN_RATE env override  (manual pin, wins while set)
 *   2. Cached live rate           (1 hour)
 *   3. Provider fetch             (open.er-api.com — no key required)
 *   4. USD_NGN_FALLBACK env, else 1600
 *
 * A failure to fetch never breaks a page: we fall back and log.
 */

import "server-only";
import { logger } from "@/lib/logger";
import { readJsonWithLimit } from "@/lib/request-body";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATE = Number(process.env.USD_NGN_FALLBACK || 1600);

type Cache = { rate: number; fetchedAt: number; source: "override" | "live" | "fallback" };

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

async function fetchLiveRate(): Promise<number | null> {
  const endpoints = [
    "https://open.er-api.com/v6/latest/USD",
    "https://api.exchangerate-api.com/v4/latest/USD",
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timeout);

      if (!response.ok) continue;

      const payload = (await response.json()) as { rates?: Record<string, number> };
      const ngn = payload.rates?.NGN;
      if (typeof ngn === "number" && Number.isFinite(ngn) && ngn > 100) return ngn;
    } catch (error) {
      logger.warn("Exchange rate provider failed", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
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
    inFlight = fetchLiveRate().finally(() => {
      inFlight = null;
    });
  }

  const live = await inFlight;
  if (live) {
    cache = { rate: live, fetchedAt: Date.now(), source: "live" };
    return { rate: live, source: "live", fetchedAt: new Date(cache.fetchedAt).toISOString() };
  }

  cache = { rate: FALLBACK_RATE, fetchedAt: Date.now(), source: "fallback" };
  logger.warn("Using fallback USD→NGN rate", { rate: FALLBACK_RATE });
  return { rate: FALLBACK_RATE, source: "fallback", fetchedAt: new Date(cache.fetchedAt).toISOString() };
}

export function clearRateCache(): void {
  cache = null;
  quoteCache.clear();
  quoteFailureUntil.clear();
}

/**
 * A purchase-sensitive quote needs a current rate, not the legacy display
 * fallback above. These are the account currencies the eSIM catalog supports.
 * An operator can pin their actual funding rate; otherwise use the same public
 * source as the rest of the app, but validate its base and publication time.
 */
export type NgnQuoteCurrency = "USD" | "EUR";
export type NgnQuoteRate = { rate: number; source: "override" | "live"; fetchedAt: string };
const QUOTE_RATE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const QUOTE_RATE_FUTURE_SKEW_MS = 5 * 60 * 1000;
const QUOTE_RATE_FAILURE_TTL_MS = 60 * 1000;
const quoteCache = new Map<NgnQuoteCurrency, { rate: NgnQuoteRate; checkedAt: number }>();
const quoteInFlight = new Map<NgnQuoteCurrency, Promise<NgnQuoteRate | null>>();
const quoteFailureUntil = new Map<NgnQuoteCurrency, number>();

async function fetchFreshNgnRate(currency: NgnQuoteCurrency): Promise<NgnQuoteRate | null> {
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${currency}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = await readJsonWithLimit(response, 256_000) as {
      result?: unknown;
      base_code?: unknown;
      time_last_update_unix?: unknown;
      rates?: { NGN?: unknown };
    };
    const rate = payload.rates?.NGN;
    const published = typeof payload.time_last_update_unix === "number" ? payload.time_last_update_unix * 1000 : NaN;
    const age = Date.now() - published;
    if (payload.result !== "success" || payload.base_code !== currency ||
        typeof rate !== "number" || !Number.isFinite(rate) || rate <= 100 ||
        !Number.isFinite(published) || age < -QUOTE_RATE_FUTURE_SKEW_MS || age > QUOTE_RATE_MAX_AGE_MS) {
      return null;
    }
    return { rate, source: "live", fetchedAt: new Date(published).toISOString() };
  } catch (error) {
    logger.warn("Current currency rate unavailable", {
      currency,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
