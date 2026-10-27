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

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATE = Number(process.env.USD_NGN_FALLBACK || 1600);

type Cache = { rate: number; fetchedAt: number; source: "override" | "live" | "fallback" };

let cache: Cache | null = null;

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

  const live = await fetchLiveRate();
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
}
