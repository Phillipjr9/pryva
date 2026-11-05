import "server-only";

import { getFreshNgnRate } from "@/lib/payments/exchange-rate";
import { smmUsdNgnRate } from "@/lib/services/boosts/smm-pricing";

/**
 * A boost-specific funding-rate pin wins when present. Otherwise use the shared
 * purchase-sensitive USD quote (an explicit USD pin or a validated authenticated
 * rate). Never use the legacy fixed fallback for a customer purchase quote.
 */
export async function resolveBoostUsdNgnRate(): Promise<number | null> {
  const pin = smmUsdNgnRate();
  if (pin !== null) return pin;
  return (await getFreshNgnRate("USD"))?.rate ?? null;
}
