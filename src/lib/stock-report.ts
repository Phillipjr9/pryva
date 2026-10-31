import type { BulkaccProduct } from "@/lib/bulkacc";
import type { Plan } from "@/lib/catalog";
import type { FleexaRentArea, FleexaSmsService } from "@/lib/fleexa";
import { matchesCountry, type PlanIntent } from "@/lib/fulfillment";
import { describeBoost, selectBoostServices } from "@/lib/smm-catalog";

/** The intents the shop lists. Anything else is a feed row we do not sell. */
const LISTED_TAGS = new Set(["Followers", "Likes", "Views", "Subscribers"]);
import type { SmmService } from "@/lib/smm-panel";

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
  /** Lines that could be bought in the next minute. */
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

function sumReported(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
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
 * The match is by country because that is all the purchase path asks the feed
 * for: `buyFleexaSmsNumber({ country })` names a destination and lets the feed
 * pick the application. Matching more narrowly here would report "no stock" for
 * a plan the checkout can still buy, which is the one mistake this page cannot
 * afford to make.
 */
export function numberPlanLines(entries: SellablePlan[], services: FleexaSmsService[]): StockLine[] {
  return entries
    .filter((entry) => entry.intent.kind === "sms")
    .map(({ plan, intent }) => {
      if (intent.kind !== "sms") throw new Error("unreachable");
      const matches = services.filter((service) =>
        matchesCountry(service.country, intent.country, plan.region),
      );
      const stock = sumReported(matches.map((service) => service.stock));
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
            : stock === null
              ? `${matches.length} listing${matches.length === 1 ? "" : "s"}, inventory not reported`
              : `${stock} unit${stock === 1 ? "" : "s"} across ${matches.length} listing${matches.length === 1 ? "" : "s"}`,
      } satisfies StockLine;
    });
}

export function rentalPlanLines(entries: SellablePlan[], areas: FleexaRentArea[]): StockLine[] {
  return entries
    .filter((entry) => entry.intent.kind === "rental")
    .map(({ plan, intent }) => {
      if (intent.kind !== "rental") throw new Error("unreachable");
      const matches = areas.filter((area) => matchesCountry(area.country, intent.country, plan.region));
      const stock = sumReported(matches.map((area) => area.stock));
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
            : stock === null
              ? `${matches.length} area${matches.length === 1 ? "" : "s"}, inventory not reported`
              : `${stock} rental${stock === 1 ? "" : "s"} available`,
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
export function boostLines(services: SmmService[], currency: string | null): StockLine[] {
  const selection = selectBoostServices(services, currency);
  const lines: StockLine[] = selection.services.map((service) => {
    const listing = describeBoost(service, currency);
    const orderable = listing.min !== null && listing.max !== null;
    return {
      id: listing.id,
      label: `${listing.platform ?? "Promotion"} ${listing.tag.toLowerCase()}`,
      state: orderable ? "in-stock" : "unknown",
      stock: null,
      note: orderable
        ? `orders of ${listing.min}–${listing.max}${service.refill ? " · refill" : ""}${currency ? ` · billed in ${currency}` : ""}`
        : "the feed did not publish a minimum and maximum",
    } satisfies StockLine;
  });

  // A panel can answer perfectly and still sell nothing: without a convertible
  // currency the retail price is unknown, and the shop refuses rather than guessing.
  // That is the difference between "down" and "misconfigured", and it is invisible
  // in a list that only contains priced services.
  const unpriced = services.filter((service) => {
    const listing = describeBoost(service, currency);
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
    sellable: lines.filter((line) => line.state === "in-stock" || line.state === "low").length,
    total: lines.length,
    lines,
    error: options.error ?? null,
  };
}

/** The one-line answer for a lane: "4 of 6 buyable now", or the reason it is not. */
export function laneHeadline(lane: StockLane): string {
  if (lane.error) return lane.error;
  if (!lane.connected) return "feed not connected";
  if (lane.total === 0) return "the feed returned nothing";
  return `${lane.sellable} of ${lane.total} buyable now`;
}
