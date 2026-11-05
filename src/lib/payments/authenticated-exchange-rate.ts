import "server-only";

import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { readJsonWithLimit } from "@/lib/platform/request-body";

/**
 * ExchangeRate-API's authenticated endpoint, for the application's NGN quotes.
 * The bearer token is never part of a URL, cache value, cache argument or log.
 * A digest distinguishes rotations without putting the token into cache keys.
 */
export type RateCurrency = "USD" | "EUR";
export type AuthenticatedRate = { currency: RateCurrency; rate: number; publishedAt: string };

const SHARED_CACHE_SECONDS = 6 * 60 * 60;
const MAX_RATE_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
// A shared cache hit may be stale while Next revalidates it in the background.
// Recheck it locally after one hour rather than retaining that stale hit for the
// entire six-hour interval. Outside Next, retain successful direct reads longer
// to avoid unnecessary provider calls from scripts and tests.
const LOCAL_SHARED_TTL_MS = 60 * 60 * 1000;
const LOCAL_DIRECT_TTL_MS = SHARED_CACHE_SECONDS * 1000;

type LocalResult = { value: AuthenticatedRate; ttlMs: number };
const localCache = new Map<string, { value: AuthenticatedRate; expiresAt: number }>();
const inFlight = new Map<string, Promise<AuthenticatedRate | null>>();
const failureUntil = new Map<string, number>();

export function authenticatedRateConfigured(): boolean {
  return Boolean(process.env.EXCHANGE_RATE_API_KEY?.trim());
}

function apiKey(): string | null {
  const key = process.env.EXCHANGE_RATE_API_KEY?.trim();
  // Valid bearer-token characters only: never pass control characters into a
  // header, and reject an unreasonable length without printing the value.
  return key && key.length <= 256 && /^[A-Za-z0-9._~+\/-]+=*$/.test(key) ? key : null;
}

function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function validRate(value: unknown, currency: RateCurrency): value is AuthenticatedRate {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<AuthenticatedRate>;
  if (quote.currency !== currency || typeof quote.rate !== "number" || !Number.isFinite(quote.rate) || quote.rate <= 100 || typeof quote.publishedAt !== "string") return false;
  const published = Date.parse(quote.publishedAt);
  const age = Date.now() - published;
  return Number.isFinite(published) && age >= -MAX_FUTURE_SKEW_MS && age <= MAX_RATE_AGE_MS;
}

/** Throws only a generic error so framework cache/revalidation logs cannot echo a credential. */
async function loadAuthenticatedRate(currency: RateCurrency, keyDigest: string): Promise<AuthenticatedRate> {
  try {
    const key = apiKey();
    if (!key || fingerprint(key) !== keyDigest) throw new Error();
    const response = await fetch(`https://v6.exchangerate-api.com/v6/latest/${currency}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error();
    const payload = await readJsonWithLimit(response, 256_000) as {
      result?: unknown;
      base_code?: unknown;
      time_last_update_unix?: unknown;
      conversion_rates?: { NGN?: unknown };
    };
    const seconds = payload.time_last_update_unix;
    const rate = payload.conversion_rates?.NGN;
    if (payload.result !== "success" || payload.base_code !== currency ||
        typeof seconds !== "number" || !Number.isFinite(seconds) ||
        typeof rate !== "number" || !Number.isFinite(rate)) throw new Error();
    const quote = { currency, rate, publishedAt: new Date(seconds * 1000).toISOString() };
    if (!validRate(quote, currency)) throw new Error();
    return quote;
  } catch {
    throw new Error("Authenticated exchange rate unavailable");
  }
}

// Store only the validated, non-secret quote across requests. Using a six-hour
// revalidation interval reduces calls to free-tier accounts (whose quota is
// shared across instances), though it is not a strict global quota guarantee.
const sharedRate = unstable_cache(loadAuthenticatedRate, ["authenticated-ngn-rate-v1"], {
  revalidate: SHARED_CACHE_SECONDS,
});

async function sharedOrDirect(currency: RateCurrency, keyDigest: string): Promise<LocalResult | null> {
  try {
    const value = await sharedRate(currency, keyDigest);
    return validRate(value, currency) ? { value, ttlMs: LOCAL_SHARED_TTL_MS } : null;
  } catch (error) {
    // Scripts/tests without a Next.js request cache retain the process-local
    // cache instead. Other cache/provider failures are returned as unavailable.
    if (error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing")) {
      try {
        const value = await loadAuthenticatedRate(currency, keyDigest);
        return { value, ttlMs: LOCAL_DIRECT_TTL_MS };
      } catch { return null; }
    }
    return null;
  }
}

export async function getAuthenticatedNgnRate(currency: RateCurrency): Promise<AuthenticatedRate | null> {
  const key = apiKey();
  if (!key) return null;
  const digest = fingerprint(key);
  const cacheKey = `${currency}:${digest}`;
  const now = Date.now();
  const cached = localCache.get(cacheKey);
  if (cached && now < cached.expiresAt && validRate(cached.value, currency)) return cached.value;
  if ((failureUntil.get(cacheKey) ?? 0) > now) return null;

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = sharedOrDirect(currency, digest).then((result) => {
      if (result) {
        localCache.set(cacheKey, { value: result.value, expiresAt: Date.now() + result.ttlMs });
        failureUntil.delete(cacheKey);
      } else {
        failureUntil.set(cacheKey, Date.now() + FAILURE_TTL_MS);
      }
      return result?.value ?? null;
    }).finally(() => { inFlight.delete(cacheKey); });
    inFlight.set(cacheKey, pending);
  }
  return pending;
}

/** Test helper; no provider cache or production database rows are changed. */
export function clearAuthenticatedRateCache(): void {
  localCache.clear();
  failureUntil.clear();
}
