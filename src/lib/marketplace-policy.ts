import { isPreviewDatabase } from "@/lib/demo-policy";
import { isBulkaccConfigured } from "@/lib/bulkacc";
import { isAccsZoneConfigured } from "@/lib/accszone";
import { isMarketplaceCatalogAvailable } from "@/lib/marketplace-suppliers";

/**
 * Live marketplace purchases are never available with demo funds.
 *
 * Two different gates, because the two sources have different verification
 * history:
 *
 *  • The primary source publishes a documented contract (product list, product
 *    info, order create, order read, balance). Per the owner's decision it goes
 *    live as soon as its server-side key exists — no second switch to forget.
 *  • The legacy source keeps its original explicit opt-in flag, because its
 *    behaviour in staging was never confirmed.
 *
 * The preview/demo database is always refused first: demo funds must never reach
 * a real supplier, even if a live key is set by accident.
 */
export function isMarketplacePurchaseEnabled(): boolean {
  if (isPreviewDatabase()) return false;
  if (isBulkaccConfigured()) return true;
  return process.env.MARKETPLACE_LIVE_PURCHASES === "true" && isAccsZoneConfigured();
}

/** Whether checkout is enabled and a catalog source is present (not a health check). */
export function isMarketplaceCheckoutConfigured(): boolean {
  return isMarketplacePurchaseEnabled() && isMarketplaceCatalogAvailable();
}
