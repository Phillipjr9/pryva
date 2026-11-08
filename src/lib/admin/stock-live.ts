import "server-only";

import { isAccsZoneConfigured } from "@/lib/providers/accszone";
import { isBulkaccConfigured, listProducts } from "@/lib/providers/bulkacc";
import {
  isBitcallConfigured,
  listBitcallOtpCountryEntries,
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
  const sellableSmsCountries = new Set(
    sellable
      .filter((entry) => entry.intent.kind === "sms")
      .map((entry) => normalizeCountryCode(entry.intent.country) ?? ""),
  );
  let smsServices: FleexaSmsService[] = [];
  let otpError: string | null = isBitcallConfigured() ? null : NOT_CONFIGURED;
  if (isBitcallConfigured()) {
    try {
      // The country catalogue is where a destination and its pooled offers are
      // stated. The service catalogue names no country at all, so building this
      // lane from it reported every destination as having no stock.
      const catalogue = await listBitcallOtpCountryEntries();
      for (const entry of catalogue) {
        const countryCode = normalizeCountryCode(entry.countryCode || entry.name);
        if (!countryCode || !sellableSmsCountries.has(countryCode)) continue;
        for (const offer of entry.pools) {
          if (!offer.serviceId) continue;
          smsServices.push({
            id: offer.serviceId,
            name: entry.name ?? countryCode,
            country: countryCode,
            priceNgn: await supplierAmountToNgn(offer.price, offer.currency),
            stock: offer.availableCount,
          });
        }
      }
    } catch (error) {
      otpError = message(error);
      logger.warn("Bitcall catalog unavailable for stock report", { error: otpError });
    }
  }
  lanes.push(summariseLane("numbers", "Virtual numbers", numberPlanLines(sellable, smsServices), {
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
      lanes.push(summariseLane("accounts", "Accounts marketplace", [], { connected: false, error: requestFailed(message(error)) }));
    }
  } else {
    const held = availableManualProducts().length;
    lanes.push(
      summariseLane("accounts", "Accounts marketplace", [], {
        connected: held > 0,
        error: held > 0 ? `${NOT_CONFIGURED} · ${held} hand-prepared listing${held === 1 ? "" : "s"}` : NOT_CONFIGURED,
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
