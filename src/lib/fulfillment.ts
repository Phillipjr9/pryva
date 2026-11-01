import { cancelBitcallOtpActivation } from "@/lib/bitcall";
import { plans, type Plan } from "@/lib/catalog";
import {
  buyFleexaRental,
  cancelFleexaSms,
  FleexaError,
  isFleexaConfigured,
  listFleexaRentAreas,
} from "@/lib/fleexa";
import {
  buyOtpNumber,
  isAmbiguousOtpPurchase,
  matchesCountry,
  otpOffersFor,
  otpSupplierConfigured,
  otpSupplierOrder,
} from "@/lib/otp-suppliers";
import { checkMargin, MARGIN_BLOCKED_MESSAGE } from "@/lib/margin-guard";
import { SERVICE_TIMEOUTS } from "@/lib/service-timeouts";

export type FulfilledOrder = {
  /**
   * Which supplier actually delivered it. A number can come from either, so the
   * caller must record this rather than assume: it is also what decides which
   * supplier a later cancel has to ask.
   */
  provider: "fleexa" | "bitcall";
  /** Charged cost where the provider reports one, else the pre-spend quote. */
  providerCostNgn: number | null;
  providerRequestId: string | null;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: Date;
  /**
   * The app this number was bought for, when the supplier named one. A fallback
   * supplier sells app-specific pools, and a customer who receives a WhatsApp
   * number when the plan said "a number" needs to be told which it is.
   */
  serviceLabel?: string | null;
};

/**
 * Explicit plan → provider mapping.
 *
 * This is an allowlist on purpose. A catalog plan promises a specific thing
 * (a destination, a duration, a unit count), and the provider is only asked
 * for something we can actually name. Every plan absent from this map fails
 * closed with SERVICE_UNAVAILABLE rather than being approximated, because a
 * wrong guess here spends real money and delivers the wrong product.
 *
 * Deliberately absent, with the reason:
 *   esim-*, proxy-*     no provider endpoint exists for eSIM or proxy at all
 *   email-*             provider email products expose no duration, so a
 *                       24-hour inbox and a 30-day inbox are indistinguishable
 *                       at purchase time — we cannot honour what the plan says
 *   vn-otp-5            a 5-code bundle; the provider sells one number per call
 *   rent-ng-7           7 days is not a whole number of provider rental months
 */
export type SmsIntent = { kind: "sms"; country: string };
export type RentalIntent = { kind: "rental"; country: string; months: number };
export type PlanIntent = SmsIntent | RentalIntent;

const FULFILMENT_MAP: Record<string, PlanIntent> = {
  "vn-ng": { kind: "sms", country: "ng" },
  "vn-us": { kind: "sms", country: "us" },
  "vn-uk": { kind: "sms", country: "gb" },
  "vn-ca": { kind: "sms", country: "ca" },
  "vn-de": { kind: "sms", country: "de" },
  "vn-gh": { kind: "sms", country: "gh" },
  "rent-ng-30": { kind: "rental", country: "ng", months: 1 },
  "rent-ng-90": { kind: "rental", country: "ng", months: 3 },
  "rent-us-30": { kind: "rental", country: "us", months: 1 },
  "rent-uk-30": { kind: "rental", country: "gb", months: 1 },
};

/**
 * Which catalog plans can actually be delivered right now.
 *
 * Exported so the storefront can stop advertising plans that would only ever
 * return a 503 — selling something undeliverable is worse than not listing it.
 */
export function isPlanFulfillable(slug: unknown): boolean {
  return typeof slug === "string" && Object.hasOwn(FULFILMENT_MAP, slug);
}

/**
 * The provider intent behind a sellable plan, or null for anything the shop must
 * not sell. Exported so stock reporting asks the same allowlist the checkout
 * uses: a report built from a second copy of this map would sooner or later
 * describe a plan that cannot be bought, or miss one that can.
 */
export function fulfilmentIntent(slug: string): PlanIntent | null {
  return Object.hasOwn(FULFILMENT_MAP, slug) ? FULFILMENT_MAP[slug] : null;
}

/** Every category plan that is actually for sale, paired with what it buys. */
export function fulfilablePlans(): Array<{ plan: Plan; intent: PlanIntent }> {
  return plans.flatMap((plan) => {
    const intent = fulfilmentIntent(plan.slug);
    return intent ? [{ plan, intent }] : [];
  });
}

/**
 * Country identifiers are the one part of this contract that could not be
 * confirmed against documentation, so they are matched tolerantly against
 * whatever the provider's own catalog returns. Matching the provider's value
 * to our ISO code (and to the plan's human region name) is deliberate: we send
 * back an identifier the provider itself published, never one we invented.
 */
/** Re-exported so existing callers keep one import; the rule lives with routing. */
export { matchesCountry };

/** Trust a provider expiry only when it parses and is still in the future. */
function providerExpiry(value: string | null, fallbackMs: number): Date {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed) && parsed > Date.now()) return new Date(parsed);
  }
  return new Date(Date.now() + fallbackMs);
}

/**
 * Buy the real service before any wallet charge happens.
 *
 * The caller only debits once this resolves, and cancels upstream if the debit
 * then fails — so a rejected or malformed provider request costs the customer
 * nothing. That ordering is what makes it safe to attempt a purchase whose
 * exact parameter contract has not yet been confirmed against the live API:
 * the failure mode is a declined order, not a lost payment.
 */
/**
 * Refuse a purchase whose cost is unknown or whose margin is below the floor.
 *
 * Fulfilment spends the owner's real provider balance, so this runs before any
 * buy call. The figures are logged for the owner only -- cost is wholesale
 * information and must never reach a customer-facing response.
 */
function guardMargin(plan: Plan, costNgn: number | null): void {
  const verdict = checkMargin(plan.price, costNgn);
  if (verdict.ok) return;
  console.error("Refusing a purchase that does not clear the margin floor", {
    slug: plan.slug,
    code: verdict.code,
    priceNgn: verdict.priceNgn,
    costNgn: verdict.costNgn,
    marginNgn: verdict.marginNgn,
  });
  throw new FleexaError(MARGIN_BLOCKED_MESSAGE, 503, verdict.code);
}

export async function fulfillPlan(plan: Plan): Promise<FulfilledOrder> {
  const intent = FULFILMENT_MAP[plan.slug];
  if (!intent) {
    throw new FleexaError(
      "That plan cannot be delivered automatically yet",
      503,
      "SERVICE_UNAVAILABLE",
    );
  }

  return intent.kind === "sms" ? fulfillNumber(plan, intent) : fulfillRental(plan, intent);
}

/**
 * A verification number, from whichever configured supplier can serve it.
 *
 * Both suppliers are asked to describe the country before either is asked to buy
 * anything, so switching suppliers on a missing key, a missing country, sold-out
 * stock or an unprofitable price costs nothing. Once a buy has been attempted the
 * search stops at the first ambiguous answer: neither supplier takes an
 * idempotency key, so a failover there would rent a second number for one order.
 */
async function fulfillNumber(plan: Plan, intent: SmsIntent): Promise<FulfilledOrder> {
  if (!otpSupplierOrder().some(otpSupplierConfigured)) {
    throw new FleexaError("Live fulfilment is not configured", 503, "NO_API_KEY");
  }

  // Every configured supplier is asked for a price, because the cheapest one is
  // the one we buy from: the selling price is fixed by the catalogue, so paying
  // less is the whole margin. Catalogue reads are bounded and briefly cached, so
  // comparing never holds a purchase hostage to a supplier that stopped answering.
  const offers = await otpOffersFor(intent.country, plan.region);

  if (offers.length === 0) {
    throw new FleexaError(
      "No number coverage is confirmed for that destination",
      503,
      "SERVICE_UNAVAILABLE",
    );
  }

  // "We do not know what it costs" is not the same as "it is sold out", and both
  // differ from "nobody serves that country" -- each is counted so the refusal
  // below can say which one happened.
  const priced = offers.filter((offer) => offer.costNgn !== null);
  if (priced.length === 0) {
    throw new FleexaError("That destination has no usable price", 503, "COST_UNKNOWN");
  }

  const sellable = priced.filter((offer) => offer.stock === null || offer.stock > 0);
  if (sellable.length === 0) {
    console.error("Every number offer for that destination is out of stock", {
      slug: plan.slug,
      country: intent.country,
      listed: offers.length,
    });
    throw new FleexaError("That destination is out of stock", 503, "SERVICE_UNAVAILABLE");
  }

  let lastError: unknown = null;
  for (const offer of sellable) {
    if (offer.costNgn === null) continue;

    // The floor is what makes "cheapest" also mean "still profitable": offers
    // are walked cheapest first, and the first one that clears the floor is the
    // cheapest sale that leaves a margin. An offer below the floor is skipped,
    // never sold at a loss.
    try {
      guardMargin(plan, offer.costNgn);
    } catch (error) {
      lastError = error;
      continue;
    }

    try {
      const bought = await buyOtpNumber(offer);
      if (
        typeof bought.providerCostNgn === "number" &&
        bought.providerCostNgn > (offer.costNgn ?? 0)
      ) {
        // The quote is the best pre-spend signal available. If the supplier
        // charged more, the sale may have landed below the floor; it cannot be
        // undone, so it is logged loudly instead of being silently absorbed.
        console.error("Provider charged more than the quoted cost", {
          slug: plan.slug,
          provider: bought.supplier,
          quotedNgn: offer.costNgn,
          chargedNgn: bought.providerCostNgn,
        });
      }
      return {
        provider: bought.supplier,
        providerCostNgn: bought.providerCostNgn ?? offer.costNgn,
        providerRequestId: bought.providerRequestId,
        referenceCode: bought.number,
        // The code arrives later; the order page polls for it.
        otpCode: null,
        expiresAt: providerExpiry(bought.expiresAt, SERVICE_TIMEOUTS.numbers.delivery),
        serviceLabel: bought.app,
      };
    } catch (error) {
      if (isAmbiguousOtpPurchase(error)) {
        // The number may exist. Retrying, or failing over, would buy a second one.
        console.error("Number purchase outcome unknown; not retrying", {
          slug: plan.slug,
          provider: offer.supplier,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error instanceof FleexaError
          ? error
          : new FleexaError("The provider did not confirm that purchase", 502, "AMBIGUOUS_PURCHASE");
      }
      console.error("Supplier could not sell that number; trying the next", {
        slug: plan.slug,
        provider: offer.supplier,
        error: error instanceof Error ? error.message : String(error),
      });
      lastError = error;
    }
  }

  throw lastError instanceof FleexaError
    ? lastError
    : new FleexaError("No provider could deliver that number right now", 503, "SERVICE_UNAVAILABLE");
}

/** Rentals have one supplier, and the rental path is unchanged. */
async function fulfillRental(plan: Plan, intent: RentalIntent): Promise<FulfilledOrder> {
  if (!isFleexaConfigured()) {
    throw new FleexaError("Live fulfilment is not configured", 503, "NO_API_KEY");
  }

  const areas = await listFleexaRentAreas();
  const area = areas.find((entry) => entry.id && matchesCountry(entry.country, intent.country, plan.region));
  if (!area?.id) {
    throw new FleexaError(
      "No rental coverage is confirmed for that destination",
      503,
      "SERVICE_UNAVAILABLE",
    );
  }
  if (typeof area.stock === "number" && area.stock <= 0) {
    throw new FleexaError("That rental is out of stock", 503, "SERVICE_UNAVAILABLE");
  }
  guardMargin(plan, area.pricePerMonthNgn != null ? area.pricePerMonthNgn * intent.months : null);

  const rental = await buyFleexaRental({ area: area.id, months: intent.months });
  const quotedRentalCost = area.pricePerMonthNgn != null ? area.pricePerMonthNgn * intent.months : null;
  return {
    provider: "fleexa",
    providerCostNgn: quotedRentalCost,
    providerRequestId: rental.rentalId,
    referenceCode: rental.number,
    otpCode: null,
    expiresAt: providerExpiry(rental.expiresAt, intent.months * 30 * 86_400_000),
  };
}

/**
 * Reverse a purchase whose wallet charge failed afterwards.
 *
 * Single-verification numbers are cancellable, so that path recovers cleanly.
 * Rentals are not: the provider exposes no cancel-rental call. Rather than hit
 * an unrelated endpoint with a rental id, this logs the identifier so the
 * charge can be reconciled by hand. The balance is checked before fulfilment,
 * which makes this path rare, but it must never fail silently.
 *
 * Returns whether an upstream release actually happened. "Nothing to cancel" and
 * "cancelled successfully" must stay distinguishable, otherwise a sweep that
 * counted no-ops would report released inventory it never touched.
 */
export async function cancelUpstream(order: {
  provider: string;
  providerRequestId: string | null;
  service: string;
  duration?: string;
}): Promise<boolean> {
  if (!order.providerRequestId) return false;

  if (order.provider === "bitcall") {
    // The same gateway also sells eSIM profiles, which store the same provider
    // value. An eSIM order must never be sent to the OTP cancel endpoint, so the
    // service is checked before the request is shaped.
    if (order.service !== "numbers") {
      console.error("Refusing to cancel a non-number order against the OTP gateway", {
        service: order.service,
        providerRequestId: order.providerRequestId,
      });
      return false;
    }
    // A rental is never bought from this supplier, so anything marked as one did
    // not come from here and must not be cancelled blind.
    if (order.duration?.startsWith("Rent")) {
      console.error("Refusing to cancel a rental against the wrong supplier", {
        providerRequestId: order.providerRequestId,
      });
      return false;
    }
    await cancelBitcallOtpActivation(order.providerRequestId);
    return true;
  }

  if (order.provider !== "fleexa") return false;

  if (order.duration?.startsWith("Rent")) {
    console.error(
      "Rental purchase needs manual reconciliation: no upstream cancel exists",
      { providerRequestId: order.providerRequestId },
    );
    return false;
  }

  await cancelFleexaSms(order.providerRequestId);
  return true;
}
