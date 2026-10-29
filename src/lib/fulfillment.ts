import type { Plan } from "@/lib/catalog";
import {
  buyFleexaRental,
  buyFleexaSmsNumber,
  cancelFleexaSms,
  FleexaError,
  isFleexaConfigured,
  listFleexaRentAreas,
} from "@/lib/fleexa";
import { SERVICE_TIMEOUTS } from "@/lib/service-timeouts";

export type FulfilledOrder = {
  provider: "fleexa";
  providerRequestId: string | null;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: Date;
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
type SmsIntent = { kind: "sms"; country: string };
type RentalIntent = { kind: "rental"; country: string; months: number };

const FULFILMENT_MAP: Record<string, SmsIntent | RentalIntent> = {
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
 * Country identifiers are the one part of this contract that could not be
 * confirmed against documentation, so they are matched tolerantly against
 * whatever the provider's own catalog returns. Matching the provider's value
 * to our ISO code (and to the plan's human region name) is deliberate: we send
 * back an identifier the provider itself published, never one we invented.
 */
function matchesCountry(value: string | null, code: string, regionName: string): boolean {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return false;
  if (candidate === code || candidate === regionName.trim().toLowerCase()) return true;
  if (code === "gb") return candidate === "uk" || candidate === "united kingdom";
  if (code === "us") return candidate === "usa" || candidate === "united states";
  return false;
}

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
export async function fulfillPlan(plan: Plan): Promise<FulfilledOrder> {
  if (!isFleexaConfigured()) {
    throw new FleexaError("Live fulfilment is not configured", 503, "NO_API_KEY");
  }

  const intent = FULFILMENT_MAP[plan.slug];
  if (!intent) {
    throw new FleexaError(
      "That plan cannot be delivered automatically yet",
      503,
      "SERVICE_UNAVAILABLE",
    );
  }

  if (intent.kind === "sms") {
    const order = await buyFleexaSmsNumber({ country: intent.country });
    return {
      provider: "fleexa",
      providerRequestId: order.requestId,
      referenceCode: order.number,
      // The code arrives later; the order page polls for it.
      otpCode: null,
      expiresAt: providerExpiry(order.expiresAt, SERVICE_TIMEOUTS.numbers.delivery),
    };
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

  const rental = await buyFleexaRental({ area: area.id, months: intent.months });
  return {
    provider: "fleexa",
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
 */
export async function cancelUpstream(order: {
  provider: string;
  providerRequestId: string | null;
  service: string;
  duration?: string;
}): Promise<void> {
  if (order.provider !== "fleexa" || !order.providerRequestId) return;

  if (order.duration?.startsWith("Rent")) {
    console.error(
      "Rental purchase needs manual reconciliation: no upstream cancel exists",
      { providerRequestId: order.providerRequestId },
    );
    return;
  }

  await cancelFleexaSms(order.providerRequestId);
}
