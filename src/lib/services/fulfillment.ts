import { BitcallError, cancelBitcallOtpActivation, isBitcallConfigured } from "@/lib/providers/bitcall";
import { plans, type Plan } from "@/lib/services/catalog";
import {
  buyFleexaRental,
  cancelFleexaSms,
  FleexaError,
  isFleexaConfigured,
  listFleexaRentAreas,
} from "@/lib/providers/fleexa";
import {
  buyOtpNumber,
  isAmbiguousOtpPurchase,
  matchesCountry,
  otpOfferPublicId,
  readOtpOffersForSupplier,
} from "@/lib/services/numbers/otp-suppliers";
import { checkMargin, MARGIN_BLOCKED_MESSAGE } from "@/lib/services/margin-guard";
import { deliveryWindowMs } from "@/lib/services/registry";
import { FLEEXA_PROVIDER, type OrderProvider } from "@/lib/services/order-providers";

export type FulfilledOrder = {
  /**
   * Which supplier actually delivered it. A number can come from either, so the
   * caller must record this rather than assume: it is also what decides which
   * supplier a later cancel has to ask.
   */
  provider: OrderProvider;
  /** Charged cost where the provider reports one, else the pre-spend quote. */
  providerCostNgn: number | null;
  providerRequestId: string | null;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: Date;
  /**
   * The app this number was bought for, when the selected live offer named one.
   * App-specific checkout records that service so the order details match the
   * customer-selected pool rather than implying a generic number.
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

/**
 * The contract we can actually fulfil through the reseller APIs. This drives the
 * storefront and the checkout gate together; anything else is intentionally not
 * offered or sold.
 */
export const SUPPORTED_VIRTUAL_NUMBER_COUNTRIES = ["ng", "us", "gb", "ca", "de", "gh"] as const;

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
 * The caller claims the order before spending and debits only after delivery.
 * If a provider accepts but the debit cannot be confirmed, the order remains in
 * review for reconciliation. A provider contract still needs live verification.
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

export type FulfillPlanOptions = {
  /** Opaque live Bitcall offer ID from the country/app catalogue. */
  otpOfferId?: string;
  /** Persist the claim immediately before starting the provider's paid call. */
  onOtpAttempt?: () => Promise<void>;
  /** Persist the activation reference before the wallet debit is attempted. */
  onOtpAccepted?: (providerRequestId: string) => Promise<void>;
  /** Rental preflight is read-only; persist the claim immediately before buying. */
  onRentalAttempt?: () => Promise<void>;
  onRentalAccepted?: (providerRequestId: string) => Promise<void>;
};

export async function fulfillPlan(plan: Plan, options: FulfillPlanOptions = {}): Promise<FulfilledOrder> {
  const intent = FULFILMENT_MAP[plan.slug];
  if (!intent) {
    throw new FleexaError(
      "That plan cannot be delivered automatically yet",
      503,
      "SERVICE_UNAVAILABLE",
    );
  }

  if (options.otpOfferId && intent.kind !== "sms") {
    throw new FleexaError("That selection is not available for this plan", 400, "INVALID_OTP_SELECTION");
  }
  return intent.kind === "sms" ? fulfillNumber(plan, intent, options) : fulfillRental(plan, intent, options);
}

/**
 * A single-use verification number, purchased from Bitcall only.
 *
 * The live offer is checked for price, stock and margin before a buy call. There
 * is no Fleexa fallback, including when Bitcall cannot be read or cannot sell the
 * requested destination. Once a buy has been attempted, an ambiguous response is
 * never retried because that could create a second number for one order.
 */
async function fulfillNumber(plan: Plan, intent: SmsIntent, options: FulfillPlanOptions): Promise<FulfilledOrder> {
  if (options.otpOfferId && (!options.onOtpAttempt || !options.onOtpAccepted)) {
    throw new FleexaError("A safe order claim is required for app-specific checkout", 400, "OTP_CLAIM_REQUIRED");
  }

  // Pryva's single-use OTP orders are routed to Bitcall only. Fleexa remains in
  // use for product families Bitcall does not provide (including the legacy
  // rental path), but must never silently receive an app-verification purchase.
  if (!isBitcallConfigured()) {
    throw new FleexaError("Live Bitcall fulfilment is not configured", 503, "NO_API_KEY");
  }

  // Resolve the current Bitcall offer for this destination before spending.
  // An app-specific selection bypasses the cache, then is matched against the
  // freshly published service ID. No customer-supplied identifier reaches the
  // provider API directly.
  // A browsing cache may be stale. Every paid checkout, including a generic
  // country plan, must use a fresh quote for its stock and margin check.
  const read = await readOtpOffersForSupplier("bitcall", intent.country, plan.region, true);
  if (read.errorCode || read.stale) {
    throw new FleexaError("The selected service could not be confirmed", read.errorCode === "INSUFFICIENT_BALANCE" ? 402 : 503, read.errorCode ?? "STALE_CATALOG");
  }
  const offers = read.offers;
  const selectedOffer = options.otpOfferId
    ? offers.find((offer) => otpOfferPublicId(intent.country, offer.ref, offer.app) === options.otpOfferId)
    : null;

  if (options.otpOfferId && (!selectedOffer || selectedOffer.supplier !== "bitcall")) {
    throw new FleexaError("That app offer is no longer available", 409, "OTP_OFFER_STALE");
  }
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
  const priced = selectedOffer
    ? selectedOffer.costNgn === null ? [] : [selectedOffer]
    : offers.filter((offer) => offer.costNgn !== null);
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

    let providerAccepted = false;
    try {
      await options.onOtpAttempt?.();
      const bought = await buyOtpNumber(offer, async (providerRequestId) => {
        providerAccepted = true;
        await options.onOtpAccepted?.(providerRequestId);
      });
      providerAccepted = true;
      if (!bought.providerRequestId) throw new Error("Provider accepted an activation without a durable reference");
      if (!bought.number) throw new Error("Provider accepted an activation without a usable phone number");
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
        expiresAt: providerExpiry(bought.expiresAt, deliveryWindowMs("numbers")),
        serviceLabel: bought.app,
      };
    } catch (error) {
      // Never cascade a failed paid request through every catalogue offer. Even a
      // definitive refusal can be account-wide (credentials, rate limit, funding),
      // and a different offer is a different app, not necessarily a substitute.
      // Keep only bounded, non-secret diagnostic fields; never log provider prose.
      const details = error instanceof BitcallError ? {
        code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "UNKNOWN",
        status: error.status,
        requestId: error.requestId && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.requestId) ? error.requestId : null,
        retryAfterSeconds: error.retryAfterSeconds,
      } : { code: "UNKNOWN", status: null, requestId: null, retryAfterSeconds: null };
      if (providerAccepted || isAmbiguousOtpPurchase(error)) {
        console.error("Number purchase outcome unknown; not retrying", { slug: plan.slug, provider: offer.supplier, ...details });
        throw new FleexaError("The provider did not confirm that purchase", 502, "AMBIGUOUS_PURCHASE");
      }
      console.error("Number purchase refused; not trying other offers", { slug: plan.slug, provider: offer.supplier, ...details });
      throw new FleexaError("The provider declined that purchase", 503, "OTP_PROVIDER_REFUSED");
    }
  }

  throw lastError instanceof FleexaError
    ? lastError
    : new FleexaError("No provider could deliver that number right now", 503, "SERVICE_UNAVAILABLE");
}

/** Rentals have one supplier, and the rental path is unchanged. */
async function fulfillRental(plan: Plan, intent: RentalIntent, options: FulfillPlanOptions): Promise<FulfilledOrder> {
  if (!isFleexaConfigured()) {
    throw new FleexaError("Live fulfilment is not configured", 503, "NO_API_KEY");
  }

  const areas = await listFleexaRentAreas();
  const matching = areas.filter((entry) => entry.id && matchesCountry(entry.country, intent.country, plan.region));
  if (matching.length === 0) {
    throw new FleexaError("No rental coverage is confirmed for that destination", 503, "SERVICE_UNAVAILABLE");
  }
  const available = matching.filter((entry) => entry.stock === null || entry.stock > 0);
  if (available.length === 0) {
    throw new FleexaError("That rental is out of stock", 503, "SERVICE_UNAVAILABLE");
  }
  // The catalogue may contain several areas for one destination. A sold-out,
  // unpriced or unprofitable first row must not hide a later usable one.
  const totalCost = (entry: (typeof areas)[number]) => entry.pricePerMonthNgn == null ? null : entry.pricePerMonthNgn * intent.months;
  const area = available.find((entry) => checkMargin(plan.price, totalCost(entry)).ok);
  if (!area) {
    const priced = available.find((entry) => totalCost(entry) !== null);
    guardMargin(plan, priced ? totalCost(priced) : null);
    throw new FleexaError("That rental is unavailable", 503, "SERVICE_UNAVAILABLE");
  }

  // Filtering above requires an id; retain that check at the paid boundary.
  const areaId = area.id;
  if (!areaId) throw new FleexaError("Rental area is unavailable", 503, "SERVICE_UNAVAILABLE");
  if (!options.onRentalAttempt || !options.onRentalAccepted) {
    throw new FleexaError("A safe order claim is required for rental checkout", 400, "RENTAL_CLAIM_REQUIRED");
  }
  await options.onRentalAttempt();
  let recorded = false;
  const recordAccepted = async (id: string) => {
    await options.onRentalAccepted!(id);
    recorded = true;
  };
  const rental = await buyFleexaRental({ area: areaId, months: intent.months }, recordAccepted);
  if (!rental.rentalId || !rental.number) throw new Error("Provider rental receipt is incomplete");
  // Also supports an adapter that returns a complete receipt without invoking
  // the callback. The actual client invokes it before validating the number.
  if (!recorded) await recordAccepted(rental.rentalId);
  const quotedRentalCost = area.pricePerMonthNgn != null ? area.pricePerMonthNgn * intent.months : null;
  return {
    provider: FLEEXA_PROVIDER,
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
