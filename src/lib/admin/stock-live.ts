import "server-only";

import { isAccsZoneConfigured } from "@/lib/providers/accszone";
import { isBulkaccConfigured, listProducts } from "@/lib/providers/bulkacc";
import {
  isBitcallConfigured,
  listBitcallOtpServices,
  type BitcallOtpService,
} from "@/lib/providers/bitcall";
import type { FleexaEmailProduct, FleexaSmsService } from "@/lib/providers/fleexa";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { logger } from "@/lib/platform/logger";
import { readSupplierSnapshot } from "@/lib/services/numbers/fleexa-catalog";
import { normalizeCountryCode } from "@/lib/services/numbers/otp-suppliers";
import { supplierAmountToNgn } from "@/lib/payments/supplier-currency";
import { fulfilablePlans } from "@/lib/services/fulfillment";
import { availableManualProducts } from "@/lib/services/accounts/manual-catalog";
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function buildStockReport(options: { refresh?: boolean } = {}): Promise<StockReport> {
  const refresh = options.refresh === true;
  const lanes: StockLane[] = [];
  const sellable = fulfilablePlans();

  /* Numbers and rentals share one feed, so they are fetched once and split. */
  if (isFleexaConfigured()) {
    try {
      const snapshot = await readSupplierSnapshot(refresh);

      // Bitcall OTP services are a second source for the same destinations:
      // merge them into the numbers list so the stock page reflects coverage
      // from either provider, not just Fleexa.
      const sellableSmsCountries = new Set(
        sellable
          .filter((entry) => entry.intent.kind === "sms")
          .map((entry) => normalizeCountryCode(entry.intent.country) ?? ""),
      );
      let smsServices: FleexaSmsService[] = snapshot.sms;
      if (isBitcallConfigured()) {
        try {
          const bitcall = await listBitcallOtpServices();
          const converted: FleexaSmsService[] = [];
          for (const service of bitcall) {
            const countryCode = normalizeCountryCode(service.countryCode);
            if (!countryCode || !sellableSmsCountries.has(countryCode)) continue;
            for (const offer of service.offers) {
              if (!offer.serviceId) continue;
              converted.push({
                id: offer.serviceId,
                name: service.name ?? offer.serviceId,
                country: countryCode,
                priceNgn: await supplierAmountToNgn(offer.price, offer.currency),
                stock: offer.availableCount,
              });
            }
          }
          if (converted.length > 0) smsServices = [...snapshot.sms, ...converted];
        } catch (error) {
          // Bitcall is additive: Fleexa may still serve these countries.
          logger.warn("Bitcall catalog unavailable for stock report", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const numbers = numberPlanLines(sellable, smsServices);
      const rentals = rentalPlanLines(sellable, snapshot.rentals);
      const suffix = snapshot.partial ? " · one of the feed's listings did not answer" : "";

      lanes.push(summariseLane("numbers", "Virtual numbers", numbers, {
        error: suffix ? `partial read${suffix}` : null,
      }));
      lanes.push(summariseLane("rentals", "Rentals", rentals, {
        error: suffix ? `partial read${suffix}` : null,
      }));

      // Email inboxes are a live feed with no sellable plan behind them: the
      // products exist, but a plan promising 24 hours cannot be honoured when the
      // feed exposes no duration. Reported so it reads as paused, not missing.
      const email: FleexaEmailProduct[] = snapshot.email;
      lanes.push(
        summariseLane(
          "email-otp",
          "Email inboxes",
          email.slice(0, 5).map((product) =>
            notSoldLine(
              product.id ?? "email",
              product.name ?? product.domain ?? "Email product",
              "feed lists this inbox, but no plan of ours is mapped to it",
            ),
          ),
        ),
      );
    } catch (error) {
      lanes.push(summariseLane("numbers", "Virtual numbers", [], { connected: false, error: message(error) }));
      lanes.push(summariseLane("rentals", "Rentals", [], { connected: false, error: message(error) }));
      lanes.push(summariseLane("email-otp", "Email inboxes", [], { connected: false, error: message(error) }));
    }
  } else {
    lanes.push(summariseLane("numbers", "Virtual numbers", [], { connected: false, error: "feed not configured" }));
    lanes.push(summariseLane("rentals", "Rentals", [], { connected: false, error: "feed not configured" }));
  }

  /* Account marketplace. */
  if (isBulkaccConfigured()) {
    try {
      const page = await listProducts(1, ACCOUNT_SAMPLE);
      const lines = accountProductLines(page.items);
      // A second marketplace can be connected and never read: the primary feed
      // wins whenever it is configured. Reporting it as a line is the difference
      // between "we have a fallback" and "we have a fallback we know works".
      if (isAccsZoneConfigured()) {
        lines.push(
          notSoldLine(
            "alternate-marketplace",
            "Alternate marketplace",
            "connected, but not the active source — it is only read when the primary feed is absent",
          ),
        );
      }
      const held = availableManualProducts().length;
      lanes.push(
        summariseLane("accounts", "Accounts marketplace", lines, {
          error:
            page.totalCount > lines.length
              ? `showing ${lines.length} of ${page.totalCount} listings${held ? ` · ${held} hand-prepared listed too` : ""}`
              : held
                ? `${held} hand-prepared listing${held === 1 ? "" : "s"} alongside the feed`
                : null,
        }),
      );
    } catch (error) {
      lanes.push(summariseLane("accounts", "Accounts marketplace", [], { connected: false, error: message(error) }));
    }
  } else {
    const held = availableManualProducts().length;
    lanes.push(
      summariseLane("accounts", "Accounts marketplace", [], {
        connected: held > 0,
        error: held > 0 ? `feed not configured · ${held} hand-prepared listing${held === 1 ? "" : "s"}` : "feed not configured",
      }),
    );
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
    lanes.push(summariseLane("boosts", "Boosts", [], { connected: false, error: "feed not configured" }));
  }

  /* Connected but deliberately not sold. */
  lanes.push(
    summariseLane(
      "esim",
      "eSIM",
      isBitcallConfigured()
        ? [notSoldLine("esim", "eSIM data plans", "feed is connected and answers balance reads, but Pryva does not sell eSIM")]
        : [],
      { connected: isBitcallConfigured(), error: isBitcallConfigured() ? null : "feed not configured" },
    ),
  );

  return { checkedAt: new Date().toISOString(), lanes };
}
