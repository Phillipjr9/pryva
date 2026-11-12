import "server-only";

import { isMarketplaceCatalogAvailable, listMarketplaceListings } from "@/lib/services/accounts/marketplace-suppliers";
import { usdMicros } from "@/lib/payments/supplier-money";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import type { FleexaEmailProduct, FleexaSmsService } from "@/lib/providers/fleexa";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { logger } from "@/lib/platform/logger";
import { readSupplierSnapshot } from "@/lib/services/numbers/fleexa-catalog";
import { normalizeCountryCode, readOtpOffersForSupplier } from "@/lib/services/numbers/otp-suppliers";
import { fulfilablePlans } from "@/lib/services/fulfillment";
import { readBoostSnapshot } from "@/lib/services/boosts/smm-catalog";
import { isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import {
  accountProductLines,
  boostLines,
  notSoldLine,
  numberPlanLines,
  rentalPlanLines,
  summariseLane,
  type StockLane,
  type StockReport,
} from "@/lib/admin/stock-report";

/**
 * Gather the live feeds into one stock report.
 *
 * Every lane is isolated: one feed that is down reports its own error and the
 * other four still answer, because the question "what can I sell right now" is
 * most useful exactly when something is broken. Nothing here places, cancels or
 * changes an order — every call is a catalog list or a balance read, and the
 * existing short read caches are reused so a refresh button cannot turn into a
 * rate-limit incident.
 */

const ACCOUNT_SAMPLE = 40;
const NOT_CONFIGURED = "not configured in this environment";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function requestFailed(messageText: string): string {
  if (!messageText) return "request failed";
  const trimmed = messageText.trim();
  const stripped = trimmed.replace(/^((marketplace|provider|supplier)\s+)/i, "").trim();
  return stripped && /request failed$/i.test(stripped)
    ? stripped
    : stripped && /request failed/i.test(stripped)
      ? stripped
      : `request failed: ${trimmed}`;
}

export async function buildStockReport(options: { refresh?: boolean } = {}): Promise<StockReport> {
  const refresh = options.refresh === true;
  const lanes: StockLane[] = [];
  const sellable = fulfilablePlans();

  /* Single-use OTP stock is Bitcall-only; rentals and inbox diagnostics stay on Fleexa. */
  const smsCountries = new Map<string, string>();
  for (const { plan, intent } of sellable) {
    if (intent.kind === "sms") smsCountries.set(intent.country, plan.region);
  }
  const smsServices: FleexaSmsService[] = [];
  const unknownCountries = new Set<string>();
  let otpError: string | null = isBitcallConfigured() ? null : NOT_CONFIGURED;
  if (isBitcallConfigured()) {
    // Reuse the same country-filtered reads as the storefront. The documented
    // country index publishes codes and starting prices, not per-service pools.
    await Promise.all([...smsCountries].map(async ([countryCode, region]) => {
      try {
        const read = await readOtpOffersForSupplier("bitcall", countryCode, region, undefined, refresh);
        if (read.errorCode || read.stale || read.partial) {
          unknownCountries.add(countryCode);
          return;
        }
        for (const offer of read.offers) {
          if (offer.supplier !== "bitcall" || normalizeCountryCode(offer.country) !== countryCode) continue;
          smsServices.push({ id: offer.ref, name: offer.app, country: countryCode, priceNgn: offer.costNgn, stock: offer.stock });
        }
      } catch {
        unknownCountries.add(countryCode);
      }
    }));
    if (unknownCountries.size) {
      otpError = "Some number catalogues could not be confirmed";
      logger.warn("Bitcall catalog incomplete for stock report", { countries: unknownCountries.size });
    }
  }
  const smsLines = numberPlanLines(sellable, smsServices).map((line) => {
    const plan = sellable.find((entry) => entry.plan.slug === line.id && entry.intent.kind === "sms");
    if (!plan || plan.intent.kind !== "sms" || !unknownCountries.has(plan.intent.country)) return line;
    return { ...line, state: "unknown" as const, stock: null, note: "the live number catalogue could not be confirmed" };
  });
  lanes.push(summariseLane("numbers", "Virtual numbers", smsLines, {
    connected: isBitcallConfigured(),
    error: otpError,
  }));

  if (isFleexaConfigured()) {
    try {
      const snapshot = await readSupplierSnapshot(refresh);
      const suffix = snapshot.partial ? "partial catalog read" : null;
      lanes.push(summariseLane("rentals", "Rentals", rentalPlanLines(sellable, snapshot.rentals), { error: suffix }));

      // Email listings have no sellable plan behind them: the feed exposes no
      // duration, so an inbox cannot yet be promised for a particular tier.
      const email: FleexaEmailProduct[] = snapshot.email;
      lanes.push(summariseLane("email-otp", "Email inboxes", email.slice(0, 5).map((product) =>
        notSoldLine(
          product.id ?? "email",
          product.name ?? product.domain ?? "Email product",
          "feed lists this inbox, but no plan of ours is mapped to it",
        ),
      ), { error: suffix }));
    } catch (error) {
      const errorMessage = message(error);
      lanes.push(summariseLane("rentals", "Rentals", [], { connected: false, error: errorMessage }));
      lanes.push(summariseLane("email-otp", "Email inboxes", [], { connected: false, error: errorMessage }));
    }
  } else {
    lanes.push(summariseLane("rentals", "Rentals", [], { connected: false, error: NOT_CONFIGURED }));
    lanes.push(summariseLane("email-otp", "Email inboxes", [], { connected: false, error: NOT_CONFIGURED }));
  }

  /* Use the same API-only inventory as the storefront, never retired manual rows. */
  if (isMarketplaceCatalogAvailable()) {
    try {
      const page = await listMarketplaceListings({ perPage: ACCOUNT_SAMPLE });
      const lines = accountProductLines(page.listings.map((listing) => ({
        code: listing.slug, name: listing.title, description: null,
        groupName: listing.group, categoryName: listing.category,
        inStock: listing.stock, min: listing.minQuantity, priceMicros: usdMicros(listing.priceUsd),
      })));
      lanes.push(summariseLane("accounts", "Accounts marketplace", lines, {
        error: page.partial ? "catalogue incomplete; some inventory could not be read"
          : page.meta.total > lines.length ? `showing ${lines.length} of ${page.meta.total} listings` : null,
      }));
    } catch (error) {
      lanes.push(summariseLane("accounts", "Accounts marketplace", [], { connected: false, error: requestFailed(message(error)) }));
    }
  } else {
    lanes.push(summariseLane("accounts", "Accounts marketplace", [], { connected: false, error: NOT_CONFIGURED }));
  }

  /* Boosts. */
  if (isSmmPanelConfigured()) {
    try {
      const snapshot = await readBoostSnapshot(refresh);
      lanes.push(
        summariseLane("boosts", "Boosts", boostLines(snapshot.services, snapshot.currency), {
          error: snapshot.partial ? "balance did not answer; the catalog did" : null,
        }),
      );
    } catch (error) {
      lanes.push(summariseLane("boosts", "Boosts", [], { connected: false, error: message(error) }));
    }
  } else {
    lanes.push(summariseLane("boosts", "Boosts", [], { connected: false, error: NOT_CONFIGURED }));
  }

  /* Connected but deliberately not sold. */
  lanes.push(
    summariseLane(
      "esim",
      "eSIM",
      isBitcallConfigured()
        ? [notSoldLine("esim", "eSIM data plans", "feed is connected and answers balance reads, but Pryva does not sell eSIM")]
        : [],
      { connected: isBitcallConfigured(), error: isBitcallConfigured() ? null : NOT_CONFIGURED },
    ),
  );

  return { checkedAt: new Date().toISOString(), lanes };
}
