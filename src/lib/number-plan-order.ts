import "server-only";

import { fulfilmentIntent } from "@/lib/fulfillment";
import { otpOffersFor, otpSupplierConfigured, otpSupplierOrder } from "@/lib/otp-suppliers";

/**
 * Show the number a customer can buy most cheaply for Pryva first.
 *
 * Every sellable number plan is one country, and each country can be served by
 * more than one supplier at a different price. The selling price is fixed by the
 * catalogue, so the cheapest supplier is also the one with the widest margin —
 * which makes "cheapest for us" and "best value first" the same ordering, with no
 * cost ever leaving the server.
 *
 * Only the ordering crosses this boundary: no price, no supplier name and no
 * availability figure is returned, because those are wholesale facts and the
 * storefront is public.
 */

/** Long enough that a listing page does not re-read catalogues on every view. */
const TTL_MS = 5 * 60_000;

/**
 * A page is not worth waiting on: if a supplier cannot quote within this window
 * the list falls back to catalogue order rather than hanging the render.
 */
const DISPLAY_BUDGET_MS = 1_500;

let cache: { at: number; costs: Map<string, number> } | null = null;

async function cheapestByCountry(countries: string[], regionNames: Map<string, string>): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.costs;

  const costs = new Map<string, number>();
  await Promise.all(
    countries.map(async (country) => {
      const offers = await otpOffersFor(country, regionNames.get(country) ?? country, {
        budgetMs: DISPLAY_BUDGET_MS,
      });
      const priced = offers.filter(
        (offer) => offer.costNgn !== null && (offer.stock === null || offer.stock > 0),
      );
      // Offers arrive cheapest first, so the head is the cheapest sellable one.
      const cheapest = priced[0];
      if (cheapest?.costNgn != null) costs.set(country, cheapest.costNgn);
    }),
  );

  cache = { at: Date.now(), costs };
  return costs;
}

/**
 * Order plans so the cheapest destination to serve comes first, keeping the
 * catalogue's own order everywhere the answer is unknown (no supplier
 * configured, a catalogue that did not answer, a country nobody prices).
 *
 * Never throws: a storefront that cannot compare prices still has to render.
 */
export async function orderNumberPlansByCheapestCost<T extends { slug: string; region: string }>(
  plans: T[],
): Promise<T[]> {
  try {
    if (!otpSupplierOrder().some(otpSupplierConfigured)) return plans;

    const intents = new Map<string, string>();
    const regionNames = new Map<string, string>();
    for (const plan of plans) {
      const intent = fulfilmentIntent(plan.slug);
      if (intent?.kind !== "sms") continue;
      intents.set(plan.slug, intent.country);
      regionNames.set(intent.country, plan.region);
    }
    if (intents.size === 0) return plans;

    const costs = await cheapestByCountry([...new Set(intents.values())], regionNames);

    return plans
      .map((plan, index) => ({ plan, index, cost: costs.get(intents.get(plan.slug) ?? "") }))
      .sort((a, b) => {
        const left = a.cost ?? Number.MAX_SAFE_INTEGER;
        const right = b.cost ?? Number.MAX_SAFE_INTEGER;
        // Stable: equal or unknown costs keep the catalogue's order.
        return left - right || a.index - b.index;
      })
      .map((entry) => entry.plan);
  } catch {
    return plans;
  }
}

/** Forget the cached comparison. Exported so a test can force a fresh read. */
export function clearNumberPlanOrderCache(): void {
  cache = null;
}
