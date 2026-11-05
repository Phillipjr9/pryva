import "server-only";

import { isAccsZoneConfigured } from "@/lib/providers/accszone";
import { isBulkaccConfigured, listProducts } from "@/lib/providers/bulkacc";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import type { FleexaEmailProduct } from "@/lib/providers/fleexa";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { readSupplierSnapshot } from "@/lib/services/numbers/fleexa-catalog";
import { fulfilablePlans } from "@/lib/services/fulfillment";
import { availableManualProducts } from "@/lib/services/accounts/manual-catalog";
import { readBoostSnapshot } from "@/lib/services/boosts/smm-catalog";
import { readEsimCatalog } from "@/lib/services/esim/esim-catalog";
import { isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import {
  accountProductLines,
  boostLines,
  esimLines,
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
      const failed = (feed: "sms" | "email" | "rentals") => snapshot.failedFeeds.includes(feed);
      const truncated = (feed: "sms" | "email" | "rentals") => snapshot.truncatedFeeds.includes(feed);
      const partialLines = (lines: ReturnType<typeof numberPlanLines>) => lines.map((line) => line.state === "no-match"
        ? { ...line, state: "unknown" as const, note: "feed sample is incomplete; no conclusion about this destination" }
        : { ...line, note: `${line.note} · feed sample is incomplete` });
      const numbers = numberPlanLines(sellable, snapshot.sms);
      const rentals = rentalPlanLines(sellable, snapshot.rentals);

      lanes.push(failed("sms")
        ? summariseLane("numbers", "Virtual numbers", [], { connected: false, error: "number feed did not answer" })
        : summariseLane("numbers", "Virtual numbers", truncated("sms") ? partialLines(numbers) : numbers, {
          error: truncated("sms") ? "number feed sample is incomplete" : null,
        }));
      lanes.push(failed("rentals")
        ? summariseLane("rentals", "Rentals", [], { connected: false, error: "rental feed did not answer" })
        : summariseLane("rentals", "Rentals", truncated("rentals") ? partialLines(rentals) : rentals, {
          error: truncated("rentals") ? "rental feed sample is incomplete" : null,
        }));

      // Email inboxes are a live feed with no sellable plan behind them: the
      // products exist, but a plan promising 24 hours cannot be honoured when the
      // feed exposes no duration. Reported so it reads as paused, not missing.
      const email: FleexaEmailProduct[] = snapshot.email;
      lanes.push(failed("email")
        ? summariseLane("email-otp", "Email inboxes", [], { connected: false, error: "email feed did not answer" })
        : summariseLane(
          "email-otp",
          "Email inboxes",
          email.slice(0, 5).map((product) =>
            notSoldLine(
              product.id ?? "email",
              product.name ?? product.domain ?? "Email product",
              "feed lists this inbox, but no plan of ours is mapped to it",
            ),
          ),
          { error: truncated("email") ? "email feed sample is incomplete" : null },
        ));
    } catch (error) {
      lanes.push(summariseLane("numbers", "Virtual numbers", [], { connected: false, error: message(error) }));
      lanes.push(summariseLane("rentals", "Rentals", [], { connected: false, error: message(error) }));
      lanes.push(summariseLane("email-otp", "Email inboxes", [], { connected: false, error: message(error) }));
    }
  } else {
    lanes.push(summariseLane("numbers", "Virtual numbers", [], { connected: false, error: "feed not configured" }));
    lanes.push(summariseLane("rentals", "Rentals", [], { connected: false, error: "feed not configured" }));
    lanes.push(summariseLane("email-otp", "Email inboxes", [], { connected: false, error: "feed not configured" }));
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
      const notes = [
        snapshot.balanceUnavailable ? "balance did not answer; account currency may be unavailable" : null,
        snapshot.partial ? "catalog sample is incomplete" : null,
      ].filter(Boolean);
      lanes.push(
        summariseLane("boosts", "Boosts", boostLines(snapshot.services, snapshot.currency, snapshot.usdNgnRate), {
          error: notes.join(" · ") || null,
        }),
      );
    } catch (error) {
      lanes.push(summariseLane("boosts", "Boosts", [], { connected: false, error: message(error) }));
    }
  } else {
    lanes.push(summariseLane("boosts", "Boosts", [], { connected: false, error: "feed not configured" }));
  }

  /* eSIM plans are sold from the live catalog; the feed does not report stock. */
  if (isBitcallConfigured()) {
    try {
      const catalog = await readEsimCatalog(refresh);
      const lines = esimLines(catalog.listings);
      const notes = [
        catalog.listings.length > lines.length ? `showing ${lines.length} of ${catalog.listings.length} plans` : null,
        catalog.partial ? "catalog read is partial" : null,
      ].filter(Boolean);
      lanes.push(summariseLane("esim", "eSIM", lines, { error: notes.join(" · ") || null }));
    } catch (error) {
      lanes.push(summariseLane("esim", "eSIM", [], { connected: false, error: message(error) }));
    }
  } else {
    lanes.push(summariseLane("esim", "eSIM", [], { connected: false, error: "feed not configured" }));
  }

  return { checkedAt: new Date().toISOString(), lanes };
}
