import "server-only";

import { createHash } from "node:crypto";
import {
  BitcallError,
  buyBitcallOtpActivation,
  isAmbiguousBitcallOutcome,
  isBitcallConfigured,
  listBitcallOtpCountryEntries,
  listBitcallOtpServices,
  otpCountrySegmentFromId,
  otpServiceLabelFromId,
} from "@/lib/providers/bitcall";
import { VERIFICATION_EXAMPLES } from "@/lib/services/service-explorer";
import { buyFleexaSmsNumber, FleexaError, isFleexaConfigured, listFleexaSmsServices } from "@/lib/providers/fleexa";
import { logger } from "@/lib/platform/logger";
import {
  supplierAmountToNgn,
  supplierAmountWithRates,
  supplierNgnRates,
} from "@/lib/payments/supplier-currency";

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
 * There is deliberately no wall-clock budget on a catalogue read.
 *
 * There used to be: four seconds for checkout, eight for browsing. Both were
 * shorter than the gateway's own per-request timeout (twenty seconds), so a slow
 * but working feed was reported as "nothing on offer" — the read was abandoned
 * for being late, and being late was never evidence about the catalogue. The
 * deadline only ever produced empty shops from impatience, and it is gone.
 *
 * The bound that remains is the network's: every gateway call carries its own
 * abort timeout, so a stalled read cannot hang forever, and it cannot be cut off
 * while it is still making progress.
 */

/** Catalogues are read-only, so a stale answer is safe for a short while. */
const CATALOGUE_TTL_MS = 60_000;

/**
 * How long a last-good read stays usable when a fresh one fails.
 *
 * Without this, one slow or failed read turned a working shop into an empty one:
 * the cached offers were already the right answer a second earlier, and a
 * read-only catalogue is not made wrong by being old. Bounded, so a feed that
 * has been down for an hour cannot keep advertising yesterday's stock.
 */
const CATALOGUE_STALE_MS = 30 * 60_000;

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

/** Reads one supplier's catalogue. Throws when it cannot be read. */
async function fetchOffers(supplier: OtpSupplierId, country: string, regionName: string): Promise<OtpOffer[]> {
  return supplier === "fleexa" ? fleexaOffers(country, regionName) : bitcallOffers(country, regionName);
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

/** The catalogue's own spelling where we recognize the brand, else a clean label. */
function canonicalServiceName(raw: string): string {
  const lower = raw.toLowerCase();
  for (const entry of VERIFICATION_EXAMPLES) {
    const brand = String(entry.brand);
    if (!lower.startsWith(brand)) continue;
    // Only a whole word counts: "threads" must not turn "threadsapp" into "Threads".
    const next = lower.charAt(brand.length);
    if (!next || /[\s/\-_,.+]/.test(next)) return entry.name;
  }
  return raw.replace(/(^|\s)([a-z])/g, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

function serviceLabel(serviceId: string): string | null {
  const raw = otpServiceLabelFromId(serviceId);
  return raw ? canonicalServiceName(raw) : null;
}

async function bitcallOffers(country: string, regionName: string): Promise<OtpOffer[]> {
  if (!isBitcallConfigured()) return [];

  // Where an offer's destination is actually stated.
  //
  // `GET /v1/otp/services` names no country and accepts no country filter: its
  // rows carry a name, a slug and pools, nothing else. The country catalogue
  // does publish a `countryCode`, and its `pools[]` are the offers for that
  // country. So the join below is the documented attribution — the previous
  // shape, filtering service rows on a `countryCode` no service row has,
  // discarded every offer for every destination. That is a catalogue which
  // reads as empty while the key, the balance and the eSIM catalogue all work.
  // The rate lookup is a second network call, so start it before the catalogue
  // read instead of after it. Run in series, either call could consume the whole
  // budget on its own — which is how a country's listing came back empty while
  // the key, the balance and the catalogue were all fine.
  void supplierNgnRates(["EUR"]).catch(() => undefined);

  const entries = await listBitcallOtpCountryEntries();
  const mine = entries.filter((entry) => matchesCountry(entry.countryCode ?? entry.name, country, regionName));
  const rows: PricedRow[] = [];
  const seen = new Set<string>();
  let poolsSeen = 0;
  for (const entry of mine) {
    for (const pool of entry.pools) {
      poolsSeen += 1;
      if (!pool.serviceId || seen.has(pool.serviceId)) continue;
      seen.add(pool.serviceId);
      rows.push({
        ref: pool.serviceId,
        app: readableApp(serviceLabel(pool.serviceId)),
        amount: pool.price,
        currency: pool.currency,
        stock: pool.availableCount,
      });
    }
  }
  const funnel = { entries: entries.length, matched: mine.length, pools: poolsSeen };
  if (rows.length > 0) return reportEmptyRead(country, funnel, await priceRows(rows, country));

  // A country entry can arrive without its inline pools: the field is documented
  // but optional. The fallback used to filter service rows on `service.countryCode`
  // — a field service rows do not carry — so it attributed nothing, for every
  // destination, and said so only by returning an empty list. Attribution now
  // comes from what the catalogue does publish:
  //
  //   1. a service row that states its own country, and
  //   2. the destination segment of the offer's own published id
  //      (`BRAVO-NG_1-whatsapp` is a Nigerian offer),
  //
  // and (2) only counts when the segment matches a code this destination itself
  // published. A code it did not publish (Ghana's, on a Nigerian read) is not
  // evidence, so coverage is never invented.
  const ownCodes = new Set(
    mine
      .flatMap((entry) => [normalizeCountryCode(entry.countryCode), normalizeCountryCode(entry.name)])
      .filter((code): code is string => code !== null),
  );
  const services = await listBitcallOtpServices({});
  for (const service of services) {
    const namesCountry = matchesCountry(service.countryCode, country, regionName);
    const app = readableApp(service.name);
    for (const entry of service.offers) {
      if (!entry.serviceId || seen.has(entry.serviceId)) continue;
      const segment = normalizeCountryCode(otpCountrySegmentFromId(entry.serviceId));
      if (!namesCountry && !(segment !== null && ownCodes.has(segment))) continue;
      seen.add(entry.serviceId);
      rows.push({
        ref: entry.serviceId,
        app,
        amount: entry.price,
        currency: entry.currency,
        stock: entry.availableCount,
      });
    }
  }
  return reportEmptyRead(country, funnel, await priceRows(rows, country));
}

/**
 * A read that succeeds and yields nothing is the one failure mode with no
 * evidence: no error, no exception, just a country with no numbers on it. The
 * funnel counters say which stage emptied it — nothing published for the
 * destination, no pools, no usable price, or rows that were dropped later for
 * want of a label — because those have entirely different fixes.
 */
function reportEmptyRead(
  country: string,
  funnel: { entries: number; matched: number; pools: number },
  offers: OtpOffer[],
): OtpOffer[] {
  if (offers.length > 0 && offers.some((offer) => offer.costNgn !== null)) return offers;
  logger.warn("Bitcall OTP catalogue produced no sellable offer", {
    country,
    entries: funnel.entries,
    matched: funnel.matched,
    pools: funnel.pools,
    offers: offers.length,
    priced: offers.filter((offer) => offer.costNgn !== null).length,
    labelled: offers.filter((offer) => offer.app !== null).length,
  });
  return offers;
}

/** One offer's attributes, before its supplier price has been converted. */
type PricedRow = {
  ref: string;
  app: string | null;
  amount: number | null;
  currency: string | null;
  stock: number | null;
};

/**
 * Convert a whole destination's rows in one pass.
 *
 * The distinct currencies are resolved concurrently — in practice that is the
 * single EUR lookup — and the conversion is then synchronous, so a country with
 * hundreds of pools costs one rate read rather than one per pool.
 */
async function priceRows(rows: PricedRow[], country: string): Promise<OtpOffer[]> {
  const rates = await supplierNgnRates(rows.map((row) => row.currency));
  return rows.map((row) => ({
    supplier: "bitcall" as const,
    ref: row.ref,
    country,
    app: row.app,
    costNgn: supplierAmountWithRates(row.amount, row.currency, rates),
    stock: row.stock,
  }));
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
  options: { app?: string | null } = {},
): Promise<OtpOffer[]> {
  const [all, wanted] = [
    await Promise.all(
      OTP_SUPPLIERS.map((supplier) =>
        otpOffersForSupplier(supplier, country, regionName)),
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
export type OtpOfferRead = {
  offers: OtpOffer[];
  errorCode: string | null;
  /**
   * True when the offers came from the last good read rather than this request.
   * They are still real offers for this country — just older than the TTL.
   */
  stale: boolean;
};

/**
 * A stable opaque id for a live listing; the provider's service reference stays
 * server-side.
 *
 * An offer whose id names no app still has an id: the app is part of the hash as
 * an empty string, so an unlabelled offer is addressable instead of invisible.
 */
export function otpOfferPublicId(country: string, ref: string, app: string | null): string {
  return `otp-${createHash("sha256").update(`${country.toLowerCase()}\0${ref}\0${app ?? ""}`).digest("hex").slice(0, 24)}`;
}

/** Read one supplier's offers while preserving a safe error code for storefront status. */
export async function readOtpOffersForSupplier(
  supplier: OtpSupplierId,
  country: string,
  regionName: string,
  refresh = false,
): Promise<OtpOfferRead> {
  if (!otpSupplierConfigured(supplier)) return { offers: [], errorCode: "NOT_CONFIGURED", stale: false };

  const key = `${supplier}:${country}`;
  const cached = catalogueCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < CATALOGUE_TTL_MS) {
    return { offers: cached.offers, errorCode: null, stale: false };
  }

  try {
    const offers = rankWithinSupplier(await fetchOffers(supplier, country, regionName));
    catalogueCache.set(key, { at: Date.now(), offers });
    return { offers, errorCode: null, stale: false };
  } catch (error) {
    const ageMs = cached ? Date.now() - cached.at : null;
    const message = error instanceof Error ? error.message : String(error);

    // Only browsing may fall back to the last good read. `refresh` is what a
    // checkout passes when it is about to spend, and there an old answer must
    // never stand in for a live one: refusing is the honest outcome.
    if (!refresh && cached && ageMs !== null && ageMs <= CATALOGUE_STALE_MS) {
      logger.warn("Serving the last good catalogue read", { supplier, ageMs, error: message });
      return { offers: cached.offers, errorCode: null, stale: true };
    }

    logger.warn("Number catalogue unavailable", { supplier, error: message });
    return { offers: [], errorCode: errorCodeOf(error), stale: false };
  }
}

export async function otpOffersForSupplier(
  supplier: OtpSupplierId,
  country: string,
  regionName: string,
  refresh = false,
): Promise<OtpOffer[]> {
  return (await readOtpOffersForSupplier(supplier, country, regionName, refresh)).offers;
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
