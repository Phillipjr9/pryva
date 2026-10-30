import { NextRequest, NextResponse } from "next/server";
import { isBulkaccConfigured, maskedKey, getBalanceMicros, probeCatalog } from "@/lib/bulkacc";
import { isAccsZoneConfigured } from "@/lib/accszone";
import {
  isFleexaConfigured,
  getFleexaBalance,
  listFleexaEmailProducts,
  listFleexaSmsServices,
  listFleexaRentAreas,
} from "@/lib/fleexa";
import { isBitcallConfigured, getBitcallBalance } from "@/lib/bitcall";
import { isSmmPanelConfigured } from "@/lib/smm-panel";
import { resendConfigured } from "@/lib/resend-config";
import { isPaystackConfigured, paystackKeyMode, getBanks } from "@/lib/paystack";
import { persistentDatabaseConfigured } from "@/lib/database-config";
import {
  isMarketplaceCheckoutConfigured,
  isMarketplacePurchaseEnabled,
} from "@/lib/marketplace-policy";
import { isMarketplaceCatalogAvailable } from "@/lib/marketplace-suppliers";
import { isManualFulfilmentReachable } from "@/lib/manual-fulfilment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Enough rows to recognise a catalog, few enough to keep the response small. */
const SAMPLE_SIZE = 5;

type Probe<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Run a read-only call and keep its failure instead of letting it take the whole
 * report down. One unreachable feed must not hide the state of the other four —
 * that is the failure mode this endpoint exists to remove.
 */
async function probe<T>(label: string, fn: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function summarize<T>(items: T[]): { count: number; sample: T[] } {
  return { count: items.length, sample: items.slice(0, SAMPLE_SIZE) };
}

/** Last four characters only. A credential is never echoed in full. */
function keyTail(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? `…${value.slice(-4)}` : null;
}

/**
 * GET /api/diagnostics/integrations
 * Authorization: Bearer <CRON_SECRET>
 *
 * Answers "which feeds are actually connected, and what does each one really
 * offer?" — neither question is answerable from the storefront, because a feed
 * that returns no products renders exactly like a feed that was never
 * configured, and `configured: true` only means an environment variable is
 * non-empty, not that the credential authenticates.
 *
 * Every call here is a read-only GET or a catalog list. Nothing can spend money.
 *
 * Secret-gated rather than public for two reasons. It reports what each feed
 * says about itself in its own words, and the owner's rule is that nothing about
 * sourcing ever reaches a customer. And each call spends a rate-limited request,
 * so an open endpoint would be a way to exhaust the budget.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    logger.warn("Unauthorized integrations diagnostics attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountsConfigured = isBulkaccConfigured();
  const numbersConfigured = isFleexaConfigured();
  const gatewayConfigured = isBitcallConfigured();

  // Read-only: catalog probes and balance reads. None of these can place an order.
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

  const numbers = numbersConfigured
    ? await (async () => {
        const [balance, emailProducts, smsServices, rentAreas] = await Promise.all([
          probe("balance", getFleexaBalance),
          probe("email", async () => summarize(await listFleexaEmailProducts())),
          probe("sms", async () => summarize(await listFleexaSmsServices())),
          probe("rent", async () => summarize(await listFleexaRentAreas())),
        ]);
        return { configured: true, keyTail: keyTail("FLEEXA_API_KEY"), balance, emailProducts, smsServices, rentAreas };
      })()
    : { configured: false as const };

  const gateway = gatewayConfigured
    ? {
        configured: true as const,
        keyTail: keyTail("BITCALL_KEY_ID"),
        balance: await probe("bitcall-balance", getBitcallBalance),
      }
    : { configured: false as const };

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
      numbers,
      gateway,
      boosting: { configured: isSmmPanelConfigured() },
      payments: isPaystackConfigured()
        ? {
            configured: true as const,
            keyTail: keyTail("PAYSTACK_SECRET_KEY"),
            // A test key cannot resolve real bank accounts, so "add a bank
            // account" fails at the resolve step. Reporting the mode says whether
            // that is an environment fact or a code bug, and the banks probe says
            // whether the credential is accepted at all.
            mode: paystackKeyMode(),
            banks: await probe("paystack-banks", async () => summarize(await getBanks())),
          }
        : { configured: false as const },
      email: { configured: resendConfigured() },
      manualFulfilmentReachable,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
