import type { BulkaccProduct } from "@/lib/providers/bulkacc";
import type { Plan } from "@/lib/services/catalog";
import type { FleexaRentArea, FleexaSmsService } from "@/lib/providers/fleexa";
import { matchesCountry, type PlanIntent } from "@/lib/services/fulfillment";
import { describeBoost, LISTED_TAGS, selectBoostServices } from "@/lib/services/boosts/smm-catalog";
import type { SmmService } from "@/lib/providers/smm-panel";
import type { EsimListing } from "@/lib/services/esim/esim-catalog";
import { safeUnitCount } from "@/lib/services/service-units";

/**
 * What is actually available right now, per sellable thing.
 *
 * The shop has always been able to say what it *would* sell; it could not say
 * what the live feeds *do* have. Numbers and rentals came from a fixed catalog
 * with no stock read at all, boosts had a per-order maximum but no availability
 * view, and the account marketplace had stock per listing that existed only
 * inside the storefront. A plan being advertised and a plan being buyable were
 * therefore the same question with different answers, and nothing compared them.
 *
 * This module is the comparison. It is pure: every function takes what a feed
 * already returned and turns it into lines with one of five states, so the same
 * judgement applies to every lane and can be pinned without a network.
 */

/**
 * `unknown` is not a synonym for zero. A feed that lists a product but reports no
 * inventory has told us something — it can probably sell it — and calling that
 * "out of stock" would hide a working lane, exactly as calling it "in stock"
 * would promise units nobody counted.
 */
export type StockState =
  | "in-stock"
  | "low"
  | "out-of-stock"
  | "no-match"
  | "unknown"
  /** Priced/listed without a stock count; checkout can still refuse. */
  | "listed"
  /** The feed lists it, but no honest price can be computed, so checkout refuses. */
  | "unpriced"
  | "not-sold";

export type StockLine = {
  id: string;
  label: string;
  state: StockState;
  /** Units the feed reports. Null means it did not say — not zero. */
  stock: number | null;
  note: string;
};

export type StockLane = {
  lane: "numbers" | "rentals" | "accounts" | "boosts" | "esim" | "email-otp";
  label: string;
  /** The feed answered at all. False with a reason in `error` is the useful case. */
  connected: boolean;
  /** Lines listed with a usable price or reported stock; not a delivery guarantee. */
  sellable: number;
  total: number;
  lines: StockLine[];
  error: string | null;
};

export type StockReport = {
  checkedAt: string;
  lanes: StockLane[];
};

/** Below this many units a lane is called low rather than healthy. */
export const LOW_STOCK_UNITS = 5;

/** How many per-product lines an accounts report carries before it summarises. */
export const MAX_ACCOUNTS_LINES = 25;

// Different app pools or rental areas may refer to the same underlying numbers.
// Do not sum them into an invented count for a plan.
function singleReported(values: Array<number | null>): number | null {
  return values.length === 1 ? safeUnitCount(values[0]) : null;
}

function inventoryState(stock: number): StockState {
  if (stock <= 0) return "out-of-stock";
  if (stock < LOW_STOCK_UNITS) return "low";
  return "in-stock";
}

/* ------------------------------------------------------------------ */
/* Numbers and rentals                                                 */
/* ------------------------------------------------------------------ */

type SellablePlan = { plan: Plan; intent: PlanIntent };

/**
 * One line per plan we sell, resolved against the feed's own catalog.
 *
 * The comparison is by country and covers this one feed only. Checkout may use
 * another supplier and chooses a specific app, price and pool. Multiple app
 * counts may overlap, so the report never treats their sum as plan inventory.
 */
export function numberPlanLines(entries: SellablePlan[], services: FleexaSmsService[]): StockLine[] {
  return entries
    .filter((entry) => entry.intent.kind === "sms")
    .map(({ plan, intent }) => {
      if (intent.kind !== "sms") throw new Error("unreachable");
      const matches = services.filter((service) =>
        matchesCountry(service.country, intent.country, plan.region) ||
        // These entries come exclusively from the documented US-only app feed.
        // This is a report mapping, not permission to buy without a priced offer.
        (service.country === null && intent.country === "us"),
      );
      const stock = singleReported(matches.map((service) => service.stock));
      const state: StockState = matches.length === 0
        ? "no-match"
        : stock === null
          ? "unknown"
          : inventoryState(stock);

      return {
        id: plan.slug,
        label: plan.planLabel,
        state,
        stock,
        note:
          matches.length === 0
            ? "the feed lists no number for this destination"
            : matches.length > 1
              ? `${matches.length} app listings; counts may overlap and cannot be combined`
              : stock === null
                ? "one app listing, inventory not reported"
                : `${stock} unit${stock === 1 ? "" : "s"} reported for one app; other sources may differ`,
      } satisfies StockLine;
    });
}

export function rentalPlanLines(entries: SellablePlan[], areas: FleexaRentArea[]): StockLine[] {
  return entries
    .filter((entry) => entry.intent.kind === "rental")
    .map(({ plan, intent }) => {
      if (intent.kind !== "rental") throw new Error("unreachable");
      const matches = areas.filter((area) => matchesCountry(area.country, intent.country, plan.region));
      const stock = singleReported(matches.map((area) => area.stock));
      const state: StockState = matches.length === 0
        ? "no-match"
        : stock === null
          ? "unknown"
          : inventoryState(stock);

      return {
        id: plan.slug,
        label: `${plan.planLabel} · ${plan.duration}`,
        state,
        stock,
        note:
          matches.length === 0
            ? "the feed lists no rental area for this destination"
            : matches.length > 1
              ? `${matches.length} areas; counts may overlap and cannot be combined`
              : stock === null
                ? "one area, inventory not reported"
                : `${stock} rental${stock === 1 ? "" : "s"} reported for this area`,
      } satisfies StockLine;
    });
}

/* ------------------------------------------------------------------ */
/* Account marketplace                                                 */
/* ------------------------------------------------------------------ */

/**
 * Per-product inventory, capped.
 *
 * `inStock === null` is the supplier declining to say, and it is reported as
 * `unknown` rather than zero — the purchase path itself treats that as buyable,
 * and a stock page that contradicts the checkout is worse than no page.
 */
export function accountProductLines(products: BulkaccProduct[], limit = MAX_ACCOUNTS_LINES): StockLine[] {
  return products.slice(0, limit).map((product) => {
    const state: StockState =
      product.inStock === null
        ? "unknown"
        : product.inStock >= product.min
          ? inventoryState(product.inStock)
          : "out-of-stock";

    return {
      id: product.code,
      label: product.name,
      state,
      stock: product.inStock,
      note:
        product.inStock === null
          ? `inventory not reported · min ${product.min}`
          : `min ${product.min} · ${product.inStock} unit${product.inStock === 1 ? "" : "s"}`,
    } satisfies StockLine;
  });
}

/* ------------------------------------------------------------------ */
/* Boosts                                                              */
/* ------------------------------------------------------------------ */

/**
 * Boosts have no inventory — a panel reports per-order minimums and maximums, not
 * units on a shelf. So the honest line is "orderable, between X and Y", and it is
 * built from exactly the selection the shop renders: the same function that
 * decides what is for sale decides what is reported as available.
 */
export function boostLines(services: SmmService[], currency: string | null, usdNgnRate?: number | null): StockLine[] {
  const selection = selectBoostServices(services, currency, usdNgnRate);
  const lines: StockLine[] = selection.services.map((service) => {
    const listing = describeBoost(service, currency, usdNgnRate);
    const orderable = listing.min !== null;
    const billedCurrency = service.currency?.trim().toUpperCase() || currency;
    return {
      id: listing.id,
      label: `${listing.platform ?? "Promotion"} ${listing.tag.toLowerCase()}`,
      state: orderable ? "listed" : "unknown",
      stock: null,
      note: orderable
        ? `orders ${listing.max === null ? `from ${listing.min} · maximum not reported` : `of ${listing.min}–${listing.max}`}${service.refill ? " · refill" : ""}${billedCurrency ? ` · billed in ${billedCurrency}` : ""}`
        : "the feed did not publish a minimum",
    } satisfies StockLine;
  });

  // A panel can answer perfectly and still sell nothing: without a convertible
  // currency the retail price is unknown, and the shop refuses rather than guessing.
  // That is the difference between "down" and "misconfigured", and it is invisible
  // in a list that only contains priced services.
  const unpriced = services.filter((service) => {
    const listing = describeBoost(service, currency, usdNgnRate);
    return listing.platform !== null && LISTED_TAGS.has(listing.tag) && listing.perThousand === null;
  }).length;

  if (unpriced > 0) {
    lines.push({
      id: "unpriced",
      label: "Listings with no price",
      state: "unpriced",
      stock: null,
      note: `${unpriced} listing${unpriced === 1 ? "" : "s"} the feed offers that we cannot price — a currency rate or markup is missing`,
    });
  }

  return lines;
}

/* eSIM plans are listed and priced, but the plan feed publishes no inventory. */
export function esimLines(listings: EsimListing[], limit = 25): StockLine[] {
  return listings.slice(0, limit).map((listing) => ({
    id: listing.id,
    label: listing.name,
    state: listing.priceNgn === null ? "unpriced" : listing.purchasable ? "listed" : "not-sold",
    stock: null,
    note: listing.priceNgn === null
      ? "plan listed, but no current price is available; inventory not reported"
      : listing.purchasable
        ? "priced plan listed; inventory not reported and checkout rechecks availability"
        : "plan listed, but not currently enabled for purchase; inventory not reported",
  }));
}

/* ------------------------------------------------------------------ */
/* Lanes we do not sell                                                */
/* ------------------------------------------------------------------ */

/**
 * A connected feed with no product on sale is the single most misleading state in
 * this system: it looks exactly like a working integration. It gets its own state
 * and its own sentence so it can never be counted as stock.
 */
export function notSoldLine(id: string, label: string, note: string): StockLine {
  return { id, label, state: "not-sold", stock: null, note };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export function summariseLane(
  lane: StockLane["lane"],
  label: string,
  lines: StockLine[],
  options: { connected?: boolean; error?: string | null } = {},
): StockLane {
  return {
    lane,
    label,
    connected: options.connected ?? true,
    sellable: lines.filter((line) => line.state === "in-stock" || line.state === "low" || line.state === "listed").length,
    total: lines.length,
    lines,
    error: options.error ?? null,
  };
}

/** A catalog/stock summary, not a guarantee of checkout or delivery. */
export function laneHeadline(lane: StockLane): string {
  if (lane.error) return lane.error;
  if (!lane.connected) return "feed not connected";
  if (lane.total === 0) return "the feed returned nothing";
  return `${lane.sellable} of ${lane.total} listed or stocked`;
}
