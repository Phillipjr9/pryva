import "server-only";

import { isBitcallConfigured } from "@/lib/bitcall";

/**
 * Whether eSIM ordering is available on this deployment.
 *
 * The name is deliberately neutral: pages import this instead of the gateway
 * client, because a customer-facing file that names the supplier fails the
 * secrecy scan — and rightly so, the import path is the leak.
 */
export function isEsimOrderingAvailable(): boolean {
  return isBitcallConfigured();
}

/**
 * Whether the *catalog's* eSIM sample plans can be bought.
 *
 * Two different things are called "an eSIM plan" in this codebase, and conflating
 * them made three public pages lie:
 *
 *   * the six written sample cards in `lib/catalog.ts` (`esim-ng-1`, …). They have
 *     no provider reference, so they can never be ordered — `FULFILMENT_MAP` is
 *     right to omit them.
 *   * the live plans read from the supplier, which are what `/dashboard/esim`
 *     sells and what `/esim` points at when a key is configured.
 *
 * `/pricing`, `/status` and the plan page asked only the first question, so with
 * eSIM trading normally they still printed "cannot be delivered yet" on all six
 * cards and "Not available" on the status page — while `/esim` said plans were
 * live and issued on purchase. Stating that a product cannot be bought while it
 * is being bought is worse than saying nothing.
 *
 * So the sale is attributed to the sample cards only while live ordering is off,
 * and withdrawn from them once the live catalogue is what a customer actually
 * buys.
 */
export function catalogEsimSampleIsSellable(): boolean {
  return !isEsimOrderingAvailable();
}
