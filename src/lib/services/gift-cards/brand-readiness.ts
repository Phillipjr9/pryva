import "server-only";
import { isFoxreloadConfigured } from "@/lib/providers/foxreload";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";

/** Do not let adding a supplier key implicitly activate legacy voucher sales. */
export function legacyBrandGiftCardSalesEnabled(): boolean {
  return !financialActionsUnavailable() && process.env.FOXRELOAD_LEGACY_GIFT_CARDS_ENABLED === "true" && process.env.FOXRELOAD_IS_MOCK !== "true" && isFoxreloadConfigured();
}
