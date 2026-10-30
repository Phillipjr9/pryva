import { NextRequest, NextResponse } from "next/server";
import { isBulkaccConfigured, maskedKey, getBalanceMicros, probeCatalog } from "@/lib/bulkacc";
import { isAccsZoneConfigured } from "@/lib/accszone";
import { isFleexaConfigured } from "@/lib/fleexa";
import { isBitcallConfigured } from "@/lib/bitcall";
import { isSmmPanelConfigured } from "@/lib/smm-panel";
import { resendConfigured } from "@/lib/resend-config";
import { isPaystackConfigured } from "@/lib/paystack";
import { persistentDatabaseConfigured } from "@/lib/database-config";
import {
  isMarketplaceCheckoutConfigured,
  isMarketplacePurchaseEnabled,
} from "@/lib/marketplace-policy";
import { isMarketplaceCatalogAvailable } from "@/lib/marketplace-suppliers";
import { isManualFulfilmentReachable } from "@/lib/manual-fulfilment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/integrations
 * Authorization: Bearer <CRON_SECRET>
 *
 * Answers "which feeds are actually connected, and why is a connected one not
 * serving anything?" — the question that cannot be answered from the storefront,
 * because a feed that returns no products renders exactly like a feed that was
 * never configured.
 *
 * Secret-gated rather than public for two reasons. It reports the reason a feed
 * refused, in that feed's own words, and the owner's rule is that nothing about
 * sourcing ever reaches a customer. And it spends a supplier request per call,
 * so an unauthenticated endpoint would be a way to exhaust the rate budget.
 *
 * Returns configuration state only. No key is ever echoed — `keyTail` is the
 * last four characters, which is enough to confirm which credential loaded.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    logger.warn("Unauthorized integrations diagnostics attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountsConfigured = isBulkaccConfigured();

  // Read-only: a catalog probe and a balance read. Neither can spend money.
  const catalog = accountsConfigured ? await probeCatalog() : { state: "not_configured" as const };

  let balanceMicros: number | null = null;
  let balanceError: string | null = null;
  if (accountsConfigured) {
    try {
      balanceMicros = await getBalanceMicros();
    } catch (error) {
      balanceError = error instanceof Error ? error.message : String(error);
    }
  }

  // Fails closed and is the only thing that can make a hand-prepared listing
  // buyable, so it is reported whether or not it currently matters.
  const manualFulfilmentReachable = await isManualFulfilmentReachable();

  return NextResponse.json(
    {
      database: { persistent: persistentDatabaseConfigured() },
      marketplace: {
        purchaseEnabled: isMarketplacePurchaseEnabled(),
        catalogAvailable: isMarketplaceCatalogAvailable(),
        checkoutConfigured: isMarketplaceCheckoutConfigured(),
      },
      accounts: {
        configured: accountsConfigured,
        keyTail: accountsConfigured ? maskedKey() : null,
        catalog,
        balanceMicros,
        balanceError,
      },
      fallbackAccounts: { configured: isAccsZoneConfigured() },
      numbers: { configured: isFleexaConfigured() },
      gateway: { configured: isBitcallConfigured() },
      boosting: { configured: isSmmPanelConfigured() },
      payments: { configured: isPaystackConfigured() },
      email: { configured: resendConfigured() },
      manualFulfilmentReachable,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
