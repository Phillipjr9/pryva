import "server-only";

import { isBitcallConfigured } from "@/lib/bitcall";
import { isPreviewDatabase } from "@/lib/demo-policy";

/**
 * Whether eSIM ordering is available on this deployment.
 *
 * The name is deliberately neutral: pages import this instead of the gateway
 * client, because a customer-facing file that names the supplier fails the
 * secrecy scan — and rightly so, the import path is the leak.
 */
export function isEsimOrderingAvailable(): boolean {
  return !isPreviewDatabase() && isBitcallConfigured();
}

/**
 * Whether eSIM should be *reported* as a category a customer can order from.
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
 * This is a question about the *category*, and it exists for `/status`, which
 * reports per-category availability. It is deliberately not a permission: the
 * six sample cards have no provider reference, so no page may offer to sell one
 * whatever this returns. `/pricing` still marks them undeliverable and points at
 * the live catalogue; the plan page still refuses to render a purchase button.
 * Those two are the places a customer would otherwise be shown a sale that
 * `/api/orders` would refuse.
 */
export function esimCategoryOrderable(): boolean {
  return isEsimOrderingAvailable();
}
