import "server-only";

import {
  buyBitcallOtpActivation,
  isAmbiguousBitcallOutcome,
  isBitcallConfigured,
  listBitcallOtpServices,
} from "@/lib/bitcall";
import { buyFleexaSmsNumber, FleexaError, isFleexaConfigured, listFleexaSmsServices } from "@/lib/fleexa";
import { logger } from "@/lib/logger";
import { supplierAmountToNgn } from "@/lib/supplier-currency";

/**
 * One verification number, from whichever supplier can actually deliver it.
 *
 * Pryva has two suppliers for this product and they describe it differently:
 * one sells "an app in a country" at a naira price, the other sells opaque
 * per-pool offers in dollars. Both can deliver the thing a customer bought — a
 * number that receives one code — so the product stays one product and the
 * supplier becomes a routing decision.
 *
 * Two rules make that safe:
 *
 *  • **Every check happens before the first buy call.** Configuration, country
 *    coverage, stock and margin are all answered from the catalogues, so moving
 *    to the next supplier costs nothing.
 *  • **A purchase that may have happened ends the search.** Both suppliers charge
 *    on every buy call and neither takes an idempotency key, so an ambiguous
 *    outcome is never retried and never failed over — that would rent two
 *    numbers for one order. `isAmbiguousOtpPurchase` is the only thing allowed to
 *    decide this, and it answers "unsafe" when it does not know.
 */

export type OtpSupplierId = "fleexa" | "bitcall";

export const OTP_SUPPLIERS: readonly OtpSupplierId[] = ["fleexa", "bitcall"] as const;

export type OtpOffer = {
  supplier: OtpSupplierId;
  /** fleexa: always the country code; bitcall: the opaque `serviceId`. */
  ref: string;
  /** Our two-letter country code, which fleexa needs alongside the app. */
  country: string;
  /** The app this pool is for, when the supplier names one. */
  app: string | null;
  /** Naira cost per number. Null means "unknown", which cannot be sold. */
  costNgn: number | null;
  /** Numbers in stock, when the supplier reports it. */
  stock: number | null;
};

export type BoughtNumber = {
  supplier: OtpSupplierId;
  providerCostNgn: number | null;
  providerRequestId: string | null;
  number: string | null;
  app: string | null;
  /** Provider-reported expiry, when it gives one the caller can trust. */
  expiresAt: string | null;
};

/** Read once so a typo in the environment cannot change routing mid-order. */
const configuredOrder: OtpSupplierId[] = (() => {
  const raw = process.env.OTP_PROVIDER_ORDER?.trim();
  if (!raw) return [...OTP_SUPPLIERS];
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is OtpSupplierId => (OTP_SUPPLIERS as readonly string[]).includes(entry));
  // Anything left that was not named keeps its default place, so a partial list
  // reorders rather than silently removing a supplier.
  return [...new Set([...parsed, ...OTP_SUPPLIERS])];
})();

/** Supplier names in the order they should be tried. Exported for diagnostics. */
export function otpSupplierOrder(): OtpSupplierId[] {
  return [...configuredOrder];
}

export function otpSupplierConfigured(supplier: OtpSupplierId): boolean {
  return supplier === "fleexa" ? isFleexaConfigured() : isBitcallConfigured();
}

/** A supplier country label matches our two-letter code, or the usual spellings. */
export function matchesCountry(value: string | null, code: string, regionName: string): boolean {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return false;
  if (candidate === code || candidate === regionName.trim().toLowerCase()) return true;
  if (code === "gb") return candidate === "uk" || candidate === "united kingdom";
  if (code === "us") return candidate === "usa" || candidate === "united states";
  return false;
}

function readableApp(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 40) return null;
  if (/bitcall|fleexa/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * Within one supplier: in-stock first, then cheapest. A supplier's own rows are
 * interchangeable, so this is pure value ordering — the cross-supplier order is
 * a policy decision and lives in `otpSupplierOrder()`.
 */
function rankWithinSupplier(offers: OtpOffer[]): OtpOffer[] {
  const stocked = (offer: OtpOffer) => (offer.stock === null ? 1 : offer.stock > 0 ? 0 : 2);
  return [...offers].sort(
    (a, b) =>
      stocked(a) - stocked(b) ||
      (a.costNgn ?? Number.MAX_SAFE_INTEGER) - (b.costNgn ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Reads one supplier's catalogue. Throws when it cannot be read. */
async function fetchOffers(supplier: OtpSupplierId, country: string, regionName: string): Promise<OtpOffer[]> {
  return supplier === "fleexa" ? fleexaOffers(country, regionName) : bitcallOffers(country);
}

async function fleexaOffers(country: string, regionName: string): Promise<OtpOffer[]> {
  if (!isFleexaConfigured()) return [];
  const services = await listFleexaSmsServices();
  const offers: OtpOffer[] = [];
  const seen = new Set<string>();
  for (const service of services) {
    if (!matchesCountry(service.country, country, regionName)) continue;
    const app = readableApp(service.name);
    // A row with no app still works: the buyer passes only the country, so
    // the country itself is the dedupe key for it.
    const key = app ?? country;
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({
      supplier: "fleexa",
      ref: country,
      country,
      app,
      costNgn: service.priceNgn,
      stock: service.stock,
    });
  }
  return offers;
}

async function bitcallOffers(country: string): Promise<OtpOffer[]> {
  if (!isBitcallConfigured()) return [];
  const services = await listBitcallOtpServices({ countryCode: country.toUpperCase() });
  const offers: OtpOffer[] = [];
  const seen = new Set<string>();
  for (const service of services) {
    const app = readableApp(service.name);
    for (const entry of service.offers) {
      if (!entry.serviceId || seen.has(entry.serviceId)) continue;
      seen.add(entry.serviceId);
      offers.push({
        supplier: "bitcall",
        ref: entry.serviceId,
        country,
        app,
        costNgn: await supplierAmountToNgn(entry.price, entry.currency),
        stock: entry.availableCount,
      });
    }
  }
  return offers;
}

/**
 * Every way this deployment can deliver a number for one country, best first.
 *
 * Order: the configured supplier order, then in-stock before unknown, then
 * cheapest. An offer whose cost is unknown sorts last because it cannot be sold
 * — it is kept so a diagnostic can say the country is covered but unpriced,
 * rather than implying nobody serves it.
 */
export async function otpOffersFor(country: string, regionName: string, app?: string | null): Promise<OtpOffer[]> {
  const all = await Promise.all(
    OTP_SUPPLIERS.map((supplier) => otpOffersForSupplier(supplier, country, regionName)),
  );
  const wanted = app?.trim().toLowerCase() || null;
  const rank = (offer: OtpOffer) => configuredOrder.indexOf(offer.supplier);

  return all
    .flat()
    .filter((offer) => !wanted || offer.app?.toLowerCase() === wanted)
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * One supplier's offers for a country, best first.
 *
 * Fetching per supplier rather than always both is what keeps the second one
 * free of consequences: a purchase only asks the next supplier once the current
 * one has nothing it can sell, so a slow or limited gateway never delays a
 * purchase the first supplier could already serve.
 */
export async function otpOffersForSupplier(
  supplier: OtpSupplierId,
  country: string,
  regionName: string,
): Promise<OtpOffer[]> {
  if (!otpSupplierConfigured(supplier)) return [];
  try {
    return rankWithinSupplier(await fetchOffers(supplier, country, regionName));
  } catch (error) {
    // A catalogue that cannot be read is skipped, not fatal: the other supplier
    // may still serve the same country.
    logger.warn("Number catalogue unavailable", {
      supplier,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Why a supplier has nothing, for the operator dashboard. Read-only: it makes no
 * buy call. Only the error's *code* is reported — never its message, which can
 * carry an upstream body, and never the credential.
 */
export async function otpSupplierProbe(
  supplier: OtpSupplierId,
  country: string,
  regionName: string,
): Promise<{ offers: OtpOffer[]; errorCode: string | null }> {
  if (!otpSupplierConfigured(supplier)) return { offers: [], errorCode: "NOT_CONFIGURED" };
  try {
    return { offers: rankWithinSupplier(await fetchOffers(supplier, country, regionName)), errorCode: null };
  } catch (error) {
    return { offers: [], errorCode: errorCodeOf(error) };
  }
}

function errorCodeOf(error: unknown): string {
  if (error instanceof FleexaError) return error.code ?? "UPSTREAM_ERROR";
  const name = error instanceof Error ? error.name : "";
  // A type name is not a message and cannot carry a response body, so it is the
  // most specific safe thing to report. A plain `Error` says nothing at all.
  if (!name || name === "Error") return "UNKNOWN_ERROR";
  return `${name.replace(/Error$/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_ERROR`;
}

/** Buy one offer. Every call here spends real supplier balance. */
export async function buyOtpNumber(offer: OtpOffer): Promise<BoughtNumber> {
  if (offer.supplier === "fleexa") {
    const order = await buyFleexaSmsNumber({
      // Pass the app when the catalogue named one: it is the difference between
      // "a Nigerian number" and "a Nigerian number that works for WhatsApp".
      app: offer.app ?? undefined,
      country: offer.country,
    });
    return {
      supplier: "fleexa",
      providerCostNgn: order.priceNgn ?? offer.costNgn,
      providerRequestId: order.requestId,
      number: order.number,
      app: offer.app,
      expiresAt: order.expiresAt,
    };
  }

  const activation = await buyBitcallOtpActivation(offer.ref);
  return {
    supplier: "bitcall",
    providerCostNgn: activation.price !== null ? await supplierAmountToNgn(activation.price, activation.currency) : offer.costNgn,
    providerRequestId: activation.activationId,
    number: activation.phoneNumber,
    app: offer.app,
    // This gateway reports no expiry on the activation itself; the caller uses
    // its own delivery window instead of inventing one.
    expiresAt: null,
  };
}

/**
 * Did this failure possibly buy a number?
 *
 * Answering "yes" (or "don't know") ends the search. Answering "no" — the two
 * "not executed" codes — lets the caller try the next supplier. Anything
 * unrecognised is treated as ambiguous: the cost of one failed order is a
 * retry, and the cost of a wrong retry is two numbers for one customer.
 */
export function isAmbiguousOtpPurchase(error: unknown): boolean {
  if (error instanceof FleexaError) {
    // Raised before any request left this process, so nothing can have been
    // bought: no key, no usable base URL, budget already spent, or a plan the
    // provider refused outright.
    return !["NO_API_KEY", "INVALID_BASE_URL", "RATE_LIMIT_UNAVAILABLE", "RATE_LIMITED"].includes(error.code ?? "");
  }
  if (error instanceof Error && error.name === "BitcallError") return isAmbiguousBitcallOutcome(error);
  // A thrown non-provider value is a bug, not a receipt: assume the worst.
  return true;
}
