import { NextRequest, NextResponse } from "next/server";
import { isBulkaccConfigured, maskedKey, getBalanceMicros, probeCatalog } from "@/lib/providers/bulkacc";
import { isAccsZoneConfigured } from "@/lib/providers/accszone";
import {
  isFleexaConfigured,
  getFleexaBalance,
  listFleexaEmailProducts,
  listFleexaSmsServices,
  listFleexaRentAreas,
} from "@/lib/providers/fleexa";
import { isBitcallConfigured, getBitcallBalance } from "@/lib/providers/bitcall";
import { esimItemsForCountry, readEsimCatalog } from "@/lib/services/esim/esim-catalog";
import { explorerCountry } from "@/lib/services/service-explorer";
import { getSmmBalance, isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import { LISTED_TAGS, describeBoost, readBoostSnapshot, selectBoostServices } from "@/lib/services/boosts/smm-catalog";
import { smmMarkupPercent, smmUsdNgnRate, totalForQuantity } from "@/lib/services/boosts/smm-pricing";
import { resendConfigured } from "@/lib/email/resend-config";
import { emailQueueStatus, recentEmailActivity } from "@/lib/email/email-delivery-events";
import { isPaystackConfigured, paystackKeyMode, getBanks } from "@/lib/payments/paystack";
import { persistentDatabaseConfigured } from "@/lib/platform/database-config";
import {
  isMarketplaceCheckoutConfigured,
  isMarketplacePurchaseEnabled,
} from "@/lib/services/accounts/marketplace-policy";
import { isMarketplaceCatalogAvailable } from "@/lib/services/accounts/marketplace-suppliers";
import { isManualFulfilmentReachable } from "@/lib/services/accounts/manual-fulfilment";
import { logger } from "@/lib/platform/logger";
import { diagnosticsAuthorized } from "@/lib/admin/diagnostics-auth";

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
 * Authorization: Bearer <DIAGNOSTICS_SECRET>  (CRON_SECRET also accepted)
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
  if (!diagnosticsAuthorized(request)) {
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

  // The eSIM catalogue is the one feed whose *size* is a support question: a
  // destination can look empty because the supplier never published a plan, or
  // because we could not price it, or because its coverage was unreadable, and
  // all three render the same on the page. This reports which one it is, and
  // ?country=NG answers "how many are actually listed for here".
  const esimCountry = explorerCountry(request.nextUrl.searchParams.get("country"));
  const gateway = gatewayConfigured
    ? {
        configured: true as const,
        keyTail: keyTail("BITCALL_KEY_ID"),
        balance: await probe("bitcall-balance", getBitcallBalance),
        esim: await probe("esim-catalog", async () => {
          const catalog = await readEsimCatalog();
          return {
            ...catalog.stats,
            partial: catalog.partial,
            ...(esimCountry
              ? { country: esimCountry.code, listedForCountry: esimItemsForCountry(catalog.listings, esimCountry.code).length }
              : {}),
          };
        }),
      }
    : { configured: false as const };

  // Fails closed and is the only thing that can make a hand-prepared listing
  // buyable, so it is reported whether or not it currently matters.
  const manualFulfilmentReachable = await isManualFulfilmentReachable();

  const boostingConfigured = isSmmPanelConfigured();

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
      boosting: boostingConfigured
        ? await (async () => {
            /**
             * "The boosting price looks wrong" was unanswerable from outside: the
             * shop shows a naira figure derived from a wholesale rate times a
             * markup times an exchange rate, and all three are configuration. This
             * reports the derivation per listed service, plus how many offers the
             * price rules dropped, so a wrong digit is visible instead of inferred.
             */
            const pricing = await probe("boost-pricing", async () => {
              const snapshot = await readBoostSnapshot();
              const selection = selectBoostServices(snapshot.services, snapshot.currency);
              const rows = snapshot.services.map((service) => describeBoost(service, snapshot.currency));
              const onShop = rows.filter((row) => row.platform !== null && LISTED_TAGS.has(row.tag));
              return {
                currency: snapshot.currency,
                markupPercent: smmMarkupPercent(),
                fxConfigured: smmUsdNgnRate() !== null,
                considered: snapshot.services.length,
                listed: selection.listed,
                // Offers on a shop platform and intent that produced no price at
                // all: either the panel quoted no rate, the currency was unknown,
                // or the computed price fell outside the plausible band.
                droppedForPrice: onShop.filter((row) => row.perThousand === null).length,
                listings: rows
                  .filter((row) => row.perThousand !== null && row.platform !== null)
                  .slice(0, 25)
                  .map((row) => ({
                    platform: row.platform,
                    tag: row.tag,
                    currency: row.currency,
                    retailPerThousand: row.perThousand,
                    min: row.min,
                    fromPrice: row.perThousand !== null && row.min !== null ? totalForQuantity(row.perThousand, row.min) : null,
                  })),
              };
            });
            return {
              configured: true as const,
              keyTail: keyTail("SMM_PANEL_API_KEY"),
              balance: await probe("smm-balance", getSmmBalance),
              pricing,
            };
          })()
        : { configured: false as const },
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
      email: {
        configured: resendConfigured(),
        // Whether the provider is reporting back at all. "sent" only means Resend
        // accepted the message, so without this an operator cannot tell a working
        // mail path from one that bounces everything.
        webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
        delivery: await probe("email-delivery", () => recentEmailActivity()),
        // Includes retry/review failures even when Resend never accepted a send.
        queue: await probe("email-queue", () => emailQueueStatus()),
      },
      manualFulfilmentReachable,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
