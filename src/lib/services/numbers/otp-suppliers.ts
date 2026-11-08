import "server-only";

import { createHash } from "node:crypto";
import {
  BitcallError,
  buyBitcallOtpActivation,
  isAmbiguousBitcallOutcome,
  isBitcallConfigured,
  listBitcallOtpServices,
} from "@/lib/providers/bitcall";
import { buyFleexaSmsNumber, FleexaError, isFleexaConfigured, listFleexaSmsServices } from "@/lib/providers/fleexa";
import { logger } from "@/lib/platform/logger";
import { supplierAmountToNgn } from "@/lib/payments/supplier-currency";

/**
 * Supplier catalog adapters for number verification.
 *
 * Bitcall is the sole supplier for new single-use OTP activations. Fleexa's SMS
 * listing and purchase adapter remain for historical diagnostics and separately
 * supported products, but neither catalog selection nor an ambiguous outcome may
 * route an OTP checkout to Fleexa. Operator reports can still compare both feeds.
 *
 * Checkout checks its selected Bitcall offer before spending and revalidates an
 * app-specific selection against the live listing. A purchase with an ambiguous
 * response is never retried or substituted; `isAmbiguousOtpPurchase` errs toward
 * reconciliation when it cannot prove the provider refused the operation.
 */

export type OtpSupplierId = "fleexa" | "bitcall";

export const OTP_SUPPLIERS: readonly OtpSupplierId[] = ["bitcall", "fleexa"] as const;

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

/**
 * How long a catalogue read may take before it is treated as "nothing on offer".
 *
 * Customer checkout reads Bitcall's live offers before it can spend. This short
 * budget keeps a stalled catalogue from holding the purchase flow. Operator
 * diagnostics may also probe Fleexa, but never as a single-use checkout fallback.
 */
const CATALOGUE_BUDGET_MS = 4_000;

/** Catalogues are read-only, so a stale answer is safe for a short while. */
const CATALOGUE_TTL_MS = 60_000;

type CacheEntry = { at: number; offers: OtpOffer[]; };
const catalogueCache = new Map<string, CacheEntry>();

/** Read once so a typo in the environment cannot reshuffle diagnostics mid-request. */
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

/** Supplier names in the order they should be probed. Exported for diagnostics. */
export function otpSupplierOrder(): OtpSupplierId[] {
  return [...configuredOrder];
}

export function otpSupplierConfigured(supplier: OtpSupplierId): boolean {
  return supplier === "fleexa" ? isFleexaConfigured() : isBitcallConfigured();
}

/** Canonicalise country codes and common provider spellings to the ISO codes we sell. */
export function normalizeCountryCode(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const aliases: Record<string, string> = {
    ng: "ng",
    nigeria: "ng",
    us: "us",
    usa: "us",
    "united states": "us",
    "united states of america": "us",
    gb: "gb",
    uk: "gb",
    "great britain": "gb",
    "united kingdom": "gb",
    ca: "ca",
    canada: "ca",
    de: "de",
    germany: "de",
    deutschland: "de",
    gh: "gh",
    ghana: "gh",
  };

  const direct = aliases[lower] ?? aliases[lower.replace(/[^a-z]/g, "")];
  if (direct) return direct;

  const compact = lower.replace(/[^a-z]/g, "");
  return compact.length === 2 ? compact : null;
}

/** A supplier country label matches our two-letter code, or the usual spellings. */
export function matchesCountry(value: string | null, code: string, regionName: string): boolean {
  const candidate = normalizeCountryCode(value);
  const target = normalizeCountryCode(code);
  const region = normalizeCountryCode(regionName);

  if (!candidate || !target) return false;
  return candidate === target || (region !== null && candidate === region);
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
 * interchangeable, so this is pure value ordering. Cross-provider comparisons
 * are retained for operator diagnostics only; single-use checkout is Bitcall-only.
 */
function rankWithinSupplier(offers: OtpOffer[]): OtpOffer[] {
  const stocked = (offer: OtpOffer) => (offer.stock === null ? 1 : offer.stock > 0 ? 0 : 2);
  return [...offers].sort(
    (a, b) =>
      stocked(a) - stocked(b) ||
      (a.costNgn ?? Number.MAX_SAFE_INTEGER) - (b.costNgn ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Cheapest first across suppliers for read-only diagnostics. Checkout does not
 * use this merged order: single-use OTP purchases resolve Bitcall offers only.
 * An offer whose cost is unknown sorts last because it cannot be sold — it may
 * still be listed in operator diagnostics as covered but unpriced.
 */
function rankByCost(offers: OtpOffer[]): OtpOffer[] {
  const stocked = (offer: OtpOffer) => (offer.stock === null ? 1 : offer.stock > 0 ? 0 : 2);
  return [...offers].sort(
    (a, b) =>
      (a.costNgn ?? Number.MAX_SAFE_INTEGER) - (b.costNgn ?? Number.MAX_SAFE_INTEGER) ||
      configuredOrder.indexOf(a.supplier) - configuredOrder.indexOf(b.supplier) ||
      stocked(a) - stocked(b),
  );
}

/** Reject after `ms`, so a slow supplier cannot hold a purchase or a page. */
function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`catalogue read exceeded ${ms}ms`)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Reads one supplier's catalogue. Throws when it cannot be read. */
async function fetchOffers(supplier: OtpSupplierId, country: string, regionName: string): Promise<OtpOffer[]> {
  return supplier === "fleexa" ? fleexaOffers(country, regionName) : bitcallOffers(country);
}

function mergeOtpOffer(existing: OtpOffer, next: OtpOffer): OtpOffer {
  return {
    ...existing,
    app: existing.app ?? next.app,
    costNgn:
      existing.costNgn === null ? next.costNgn :
      next.costNgn === null ? existing.costNgn :
      Math.min(existing.costNgn, next.costNgn),
    stock:
      existing.stock === null || next.stock === null ? null :
      existing.stock + next.stock,
  };
}

async function fleexaOffers(country: string, regionName: string): Promise<OtpOffer[]> {
  if (!isFleexaConfigured()) return [];
  const services = await listFleexaSmsServices();
  const offersByKey = new Map<string, OtpOffer>();
  for (const service of services) {
    if (!matchesCountry(service.country, country, regionName)) continue;
    const app = readableApp(service.name);
    const key = app ?? country;
    const next: OtpOffer = {
      supplier: "fleexa",
      ref: country,
      country,
      app,
      costNgn: service.priceNgn,
      stock: service.stock,
    };
    const existing = offersByKey.get(key);
    offersByKey.set(key, existing ? mergeOtpOffer(existing, next) : next);
  }
  return [...offersByKey.values()];
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
 * Merge configured provider catalogs for read-only operator diagnostics.
 *
 * This is deliberately not used by customer checkout. Order is cheapest first,
 * with ties by configured diagnostic order; an offer whose cost is unknown sorts
 * last so operators can distinguish unpriced coverage from no coverage.
 */
export async function otpOffersFor(
  country: string,
  regionName: string,
  options: { app?: string | null; budgetMs?: number } = {},
): Promise<OtpOffer[]> {
  const [all, wanted] = [
    await Promise.all(
      OTP_SUPPLIERS.map((supplier) =>
        otpOffersForSupplier(supplier, country, regionName, options.budgetMs ?? CATALOGUE_BUDGET_MS)),
    ),
    options.app?.trim().toLowerCase() || null,
  ] as const;

  return rankByCost(all.flat().filter((offer) => !wanted || offer.app?.toLowerCase() === wanted));
}

/** Forget cached catalogues. Exported so a test can prove a fresh read happens. */
export function clearOtpCatalogueCache(): void {
  catalogueCache.clear();
}

/**
 * One supplier's offers for a country, best first. Customer OTP checkout calls
 * this with `bitcall`; the second adapter remains available for diagnostics and
 * the separate Fleexa rental service.
 */
export type OtpOfferRead = { offers: OtpOffer[]; errorCode: string | null };

/** A stable opaque id for a live listing; the provider's service reference stays server-side. */
export function otpOfferPublicId(country: string, ref: string, app: string): string {
  return `otp-${createHash("sha256").update(`${country.toLowerCase()}\0${ref}\0${app}`).digest("hex").slice(0, 24)}`;
}

/** Read one supplier's offers while preserving a safe error code for storefront status. */
export async function readOtpOffersForSupplier(
  supplier: OtpSupplierId,
  country: string,
  regionName: string,
  budgetMs: number = CATALOGUE_BUDGET_MS,
  refresh = false,
): Promise<OtpOfferRead> {
  if (!otpSupplierConfigured(supplier)) return { offers: [], errorCode: "NOT_CONFIGURED" };

  const key = `${supplier}:${country}`;
  const cached = catalogueCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return { offers: cached.offers, errorCode: null };

  try {
    const offers = rankWithinSupplier(await withBudget(fetchOffers(supplier, country, regionName), budgetMs));
    catalogueCache.set(key, { at: Date.now(), offers });
    return { offers, errorCode: null };
  } catch (error) {
    logger.warn("Number catalogue unavailable", {
      supplier,
      error: error instanceof Error ? error.message : String(error),
    });
    return { offers: [], errorCode: errorCodeOf(error) };
  }
}

export async function otpOffersForSupplier(
  supplier: OtpSupplierId,
  country: string,
  regionName: string,
  budgetMs: number = CATALOGUE_BUDGET_MS,
): Promise<OtpOffer[]> {
  return (await readOtpOffersForSupplier(supplier, country, regionName, budgetMs)).offers;
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
  if (error instanceof BitcallError) return error.code ?? "BIT_CALL_ERROR";
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
