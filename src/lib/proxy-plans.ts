import "server-only";

import { fleexaProxyPlanMap, isFleexaConfigured } from "@/lib/fleexa";

/**
 * What each published proxy plan actually buys.
 *
 * Residential proxies are the one product here whose cost is variable — the
 * supplier bills per gigabyte consumed — so the allowance and the expiry are not
 * marketing copy, they are the terms of the sub-user we have to create. That is
 * why they live in code, next to the catalogue, instead of being read off a
 * `planLabel` at purchase time: "5GB · 30 days" is a string, and a string cannot
 * be sent to a quota API.
 *
 * A plan with no entry here cannot be sold even when a supplier is configured,
 * which is the safe direction for a typo.
 */
export type ProxyPlanQuota = {
  /** Purchased traffic, in whole gigabytes. */
  gigabytes: number;
  /** How long the credentials stay valid. */
  days: number;
  /** ISO country the pool is in, or `EU` for a regional pool. */
  region: string;
};

export const PROXY_PLAN_QUOTAS: Record<string, ProxyPlanQuota> = {
  "proxy-ng-1": { gigabytes: 1, days: 7, region: "NG" },
  "proxy-ng-5": { gigabytes: 5, days: 30, region: "NG" },
  "proxy-ng-25": { gigabytes: 25, days: 30, region: "NG" },
  "proxy-us-5": { gigabytes: 5, days: 30, region: "US" },
  "proxy-eu-10": { gigabytes: 10, days: 30, region: "EU" },
};

export function proxyQuotaFor(slug: unknown): ProxyPlanQuota | null {
  return typeof slug === "string" && Object.hasOwn(PROXY_PLAN_QUOTAS, slug) ? PROXY_PLAN_QUOTAS[slug] : null;
}

/** The supplier's product for a plan, or null when the deployment has not mapped one. */
export function proxyProductIdFor(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  return fleexaProxyPlanMap()[slug] ?? null;
}

/**
 * Is proxy ordering switched on at all?
 *
 * Three independent things, deliberately: a supplier key, an explicit enable
 * flag, and a plan→product map. The flag is what stops a half-configured
 * deployment from charging for a proxy it cannot deliver, and the map is what
 * stops us from guessing which of the supplier's products is "5GB in Nigeria".
 */
export function isProxyOrderingAvailable(): boolean {
  return (
    process.env.FLEEXA_PROXY_ENABLED?.trim() === "1" &&
    isFleexaConfigured() &&
    Object.keys(fleexaProxyPlanMap()).length > 0
  );
}

/** A plan is only sellable when ordering is on *and* that plan has a product and a quota. */
export function isProxyPlanSellable(slug: unknown): boolean {
  return isProxyOrderingAvailable() && proxyProductIdFor(slug) !== null && proxyQuotaFor(slug) !== null;
}
