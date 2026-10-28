import { isPreviewDatabase } from "@/lib/demo-policy";
import { isAccsZoneConfigured } from "@/lib/accszone";

/** Live marketplace purchases are opt-in, never available with demo funds. */
export function isMarketplacePurchaseEnabled(): boolean {
  return !isPreviewDatabase() && process.env.MARKETPLACE_LIVE_PURCHASES === "true";
}

/** Whether checkout is enabled and a supplier credential is present (not a health check). */
export function isMarketplaceCheckoutConfigured(): boolean {
  return isMarketplacePurchaseEnabled() && isAccsZoneConfigured();
}
