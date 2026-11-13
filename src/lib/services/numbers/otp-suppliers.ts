import "server-only";

import { createHash } from "node:crypto";
import {
  BitcallError,
  buyBitcallOtpActivation,
  isAmbiguousBitcallOutcome,
  isBitcallConfigured,
  listBitcallOtpCountryEntries,
  listBitcallOtpServices,
  type BitcallOtpCountryEntry,
  type BitcallOtpOffer,
} from "@/lib/providers/bitcall";
import { buyFleexaSmsNumber, FleexaError, isFleexaConfigured, listFleexaSmsServices } from "@/lib/providers/fleexa";
import { logger } from "@/lib/platform/logger";
import { supplierAmountToNgn, supplierAmountWithRates, supplierNgnRates } from "@/lib/payments/supplier-currency";
import { EXPLORER_COUNTRIES } from "@/lib/content/explorer-countries";

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
 * Bitcall's OTP feed can legitimately take longer than a few seconds when it is
 * serving a wider publish set or a slow region. This budget is deliberately
 * above the previous short value so a valid, slower read is not mistaken for a
 * dead feed and a customer-facing verification list disappears.
 */
const CATALOGUE_BUDGET_MS = 12_000;

/** Catalogues are read-only, so a stale answer is safe for a short while. */
const CATALOGUE_TTL_MS = 60_000;

type CacheEntry = { at: number; offers: OtpOffer[]; };
const catalogueCache = new Map<string, CacheEntry>();
const catalogueReads = new Map<string, Promise<OtpOfferRead>>();
const latestCatalogueRead = new Map<string, number>();
let catalogueSequence = 0;
/** Per-instance cooldown after the gateway throttles a catalogue read. */
let bitcallCatalogueRetryAt = 0;
let countryCache: { at: number; entries: BitcallOtpCountryEntry[] } | null = null;
let countryRead: Promise<BitcallOtpCountryEntry[]> | null = null;

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

/** Reject and cancel the provider walk when the overall catalogue budget ends. */
function withBudget<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`catalogue read exceeded ${ms}ms`));
    }, ms);
    Promise.resolve().then(() => work(controller.signal)).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); controller.abort(); reject(error); },
    );
  });
}

/** Reads one supplier's catalogue. Throws when it cannot be read. */
async function fetchOffers(
  supplier: OtpSupplierId, country: string, regionName: string, signal?: AbortSignal, refresh = false,
): Promise<{ offers: OtpOffer[]; partial: boolean }> {
  return supplier === "fleexa"
    ? { offers: await fleexaOffers(country, regionName), partial: false }
    : bitcallOffers(country, regionName, signal, refresh);
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

/** A shared cold read avoids re-fetching the country list for every destination. */
function bitcallCountries(refresh: boolean): Promise<BitcallOtpCountryEntry[]> {
  if (!refresh && countryCache && Date.now() - countryCache.at < CATALOGUE_TTL_MS) {
    return Promise.resolve(countryCache.entries);
  }
  if (countryRead) return countryRead;
  // The country walk has its own deadline: one caller timing out must not abort
  // the same shared read for a different country. A caller whose own budget
  // expires still cannot start any subsequent service requests.
  let current: Promise<BitcallOtpCountryEntry[]>;
  current = listBitcallOtpCountryEntries({ signal: AbortSignal.timeout(CATALOGUE_BUDGET_MS) })
    .then((entries) => {
      if (countryRead === current) countryCache = { at: Date.now(), entries };
      return entries;
    })
    .finally(() => { if (countryRead === current) countryRead = null; });
  countryRead = current;
  return current;
}

/** Recognize the provider's published ISO-like code, not an opaque offer ID. */
function bitcallCountryIso(value: string | null): string | null {
  const match = value?.trim().match(/^([a-z]{2}|usa)(?:[_-]\d+)?$/i);
  return match ? normalizeCountryCode(match[1]) : null;
}

function countryName(value: string | null): string | null {
  // Parentheses can distinguish real destinations (e.g. the two Congos or
  // Virgin Islands), so strip only the documented virtual qualifier and the
  // ISO directory's trailing article—not arbitrary geographic qualifiers.
  return value?.replace(/\s*\((?:virtual|the)\)\s*$/i, "").trim() || null;
}

const bitcallCountryNames = new Map(EXPLORER_COUNTRIES.map((entry) => [entry.name.toLocaleLowerCase(), entry.code]));
function bitcallCountryNameIso(name: string | null): string | null {
  return name && !/\d/.test(name)
    ? normalizeCountryCode(name) ?? bitcallCountryNames.get(name.toLocaleLowerCase()) ?? null
    : null;
}

export function bitcallDeclaredCountryMatches(value: string, country: string, regionName: string): boolean {
  const target = normalizeCountryCode(country);
  const named = countryName(value);
  const actual = bitcallCountryIso(value) ?? bitcallCountryNameIso(named);
  if (actual) return actual === target;
  return !!named && !/\d/.test(named) && named.toLocaleLowerCase() === regionName.trim().toLocaleLowerCase();
}

/** Never build a provider country identifier: send back only one it published. */
function bitcallCodesForCountry(entries: BitcallOtpCountryEntry[], country: string, regionName: string): { codes: string[]; partial: boolean } {
  const target = normalizeCountryCode(country);
  if (!target) return { codes: [], partial: false };
  const codes = new Set<string>();
  let partial = false;
  for (const entry of entries) {
    const code = entry.countryCode?.trim();
    if (!code || code.length > 100) continue;
    const byCode = bitcallCountryIso(code);
    const name = countryName(entry.name);
    const byName = bitcallCountryNameIso(name);
    const namedTarget = byName === target || (!!name && name.toLocaleLowerCase() === regionName.trim().toLocaleLowerCase());
    if (byCode && byName && byCode !== byName && (byCode === target || byName === target)) {
      // Log only recognized ISO codes, not raw supplier-controlled text.
      logger.warn("Conflicting OTP country metadata", { requested: target, codeCountry: byCode, nameCountry: byName });
      partial = true;
      continue;
    }
    if (byCode === target || (!byCode && namedTarget)) codes.add(code);
  }
  // A malformed upstream response must not turn a single browse into an
  // unbounded fan-out; never silently present a truncated read as complete.
  if (codes.size > 10) throw new BitcallError("Too many OTP country filters", 502, "CATALOGUE_INCOMPLETE");
  return { codes: [...codes], partial };
}

async function bitcallOffers(country: string, regionName: string, signal?: AbortSignal, refresh = false): Promise<{ offers: OtpOffer[]; partial: boolean }> {
  if (!isBitcallConfigured()) return { offers: [], partial: false };
  if (bitcallCatalogueRetryAt > Date.now()) {
    throw new BitcallError("OTP catalogue is cooling down", 429, "LOCAL_RATE_BUDGET", null, [],
      Math.ceil((bitcallCatalogueRetryAt - Date.now()) / 1000));
  }

  const countries = await bitcallCountries(refresh);
  if (signal?.aborted) throw new BitcallError("OTP catalogue read expired", 502, "CATALOGUE_INCOMPLETE");
  const { codes, partial } = bitcallCodesForCountry(countries, country, regionName);
  const seen = new Map<string, { app: string | null; entry: BitcallOtpOffer }>();

  // The documented country_code filter makes each pool in the response an
  // offer for that country even when the service row has no country field.
  // Reject explicit contradictory country metadata instead of masking it with
  // the requested code. A later exact-offer read verifies country at checkout.
  for (let start = 0; start < codes.length; start += 2) {
    if (signal?.aborted) throw new BitcallError("OTP catalogue read expired", 502, "CATALOGUE_INCOMPLETE");
    const pages = await Promise.all(codes.slice(start, start + 2).map((countryCode) =>
      listBitcallOtpServices({ countryCode }, { signal }),
    ));
    for (const services of pages) for (const service of services) {
      const serviceCountries = [service.countryCode, ...(service.declaredCountries ?? [])].filter((value): value is string => !!value);
      if (serviceCountries.some((value) => !bitcallDeclaredCountryMatches(value, country, regionName))) {
        throw new BitcallError("Conflicting OTP service country", 502, "SERVICE_RESPONSE_INVALID");
      }
      const app = readableApp(service.name);
      for (const entry of service.offers) {
        const offerCountries = [entry.countryCode, ...(entry.declaredCountries ?? [])].filter((value): value is string => !!value);
        if (offerCountries.some((value) => !bitcallDeclaredCountryMatches(value, country, regionName))) {
          throw new BitcallError("Conflicting OTP offer country", 502, "SERVICE_RESPONSE_INVALID");
        }
        if (!entry.serviceId) continue;
        const previous = seen.get(entry.serviceId);
        if (previous) {
          if (previous.app !== app || previous.entry.price !== entry.price ||
              previous.entry.currency !== entry.currency || previous.entry.availableCount !== entry.availableCount) {
            throw new BitcallError("Conflicting OTP offer data", 502, "SERVICE_RESPONSE_INVALID");
          }
          continue;
        }
        seen.set(entry.serviceId, { app, entry });
      }
    }
  }

  // Bitcall settles in the account's reported currency. Unlike some other
  // suppliers, an absent currency is not evidence of USD and cannot be sold.
  const rates = await supplierNgnRates([...seen.values()].flatMap(({ entry }) =>
    entry.currency && entry.price !== null && entry.price > 0 ? [entry.currency] : [],
  ));
  const offers = [...seen.entries()].map(([ref, { app, entry }]) => ({
    supplier: "bitcall" as const,
    ref,
    country,
    app,
    costNgn: entry.currency && rates.get(entry.currency) != null
      ? supplierAmountWithRates(entry.price, entry.currency, rates) : null,
    stock: entry.availableCount,
  }));
  return { offers, partial };
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
  catalogueReads.clear();
  latestCatalogueRead.clear();
  countryCache = null;
  countryRead = null;
  bitcallCatalogueRetryAt = 0;
}

/**
 * One supplier's offers for a country, best first. Customer OTP checkout calls
 * this with `bitcall`; the second adapter remains available for diagnostics and
 * the separate Fleexa rental service.
 */
export type OtpOfferRead = {
  offers: OtpOffer[];
  errorCode: string | null;
  partial?: boolean;
  degraded?: "funding" | "outage" | null;
  stale?: boolean;
  /** When this catalogue was actually read, including when a cache is reused. */
  fetchedAt?: string | null;
  /** Seconds until another supplier catalogue read is appropriate, if throttled. */
  retryAfterSeconds?: number | null;
};

/** A stable opaque id for a live listing; the provider's service reference stays server-side. */
export function otpOfferPublicId(country: string, ref: string, app: string | null): string {
  return `otp-${createHash("sha256").update(`${country.toLowerCase()}\0${ref}\0${app ?? ""}`).digest("hex").slice(0, 24)}`;
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
  if (!refresh && cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return {
    offers: cached.offers, errorCode: null, partial: false, degraded: null, stale: false,
    fetchedAt: new Date(cached.at).toISOString(),
  };

  // Share only ordinary browsing reads with the same deadline. Checkout refreshes
  // always start a fresh read and never attach to an older browse in flight.
  const pendingKey = `${key}:${budgetMs}`;
  const pending = !refresh ? catalogueReads.get(pendingKey) : undefined;
  if (pending) return pending;
  const sequence = ++catalogueSequence;
  latestCatalogueRead.set(key, sequence);

  const load = async (): Promise<OtpOfferRead> => {
    try {
      const result = await withBudget((signal) => fetchOffers(supplier, country, regionName, signal, refresh), budgetMs);
      const offers = rankWithinSupplier(result.offers);
      const at = Date.now();
      // An older request, or one started before cache invalidation, must not
      // overwrite a later checkout/refresh result.
      if (!result.partial && latestCatalogueRead.get(key) === sequence) catalogueCache.set(key, { at, offers });
      // Fail checkout closed on a partial directory; browsing can still show the
      // unambiguous offers with a clear incomplete flag.
      return { offers, errorCode: result.partial ? "SERVICE_RESPONSE_INVALID" : null, partial: result.partial,
        degraded: result.partial ? "outage" : null, stale: false, fetchedAt: new Date(at).toISOString() };
    } catch (error) {
      const retryAfterSeconds = bitcallCatalogueCooldown(error);
      const stale = cached && Date.now() - cached.at < CATALOGUE_TTL_MS * 3 ? cached.offers : null;
      if (stale && stale.length > 0) {
        logger.warn("Using stale number catalogue after a transient outage", {
          supplier,
          country,
          staleOffers: stale.length,
          error: error instanceof Error ? error.message : String(error),
        });
        return { offers: stale, errorCode: errorCodeOf(error), partial: true, degraded: "outage", stale: true,
          fetchedAt: new Date(cached!.at).toISOString(), retryAfterSeconds };
      }
      logger.warn("Number catalogue unavailable", {
        supplier,
        error: error instanceof Error ? error.message : String(error),
      });
      return { offers: [], errorCode: errorCodeOf(error), partial: false, degraded: "outage", retryAfterSeconds };
    }
  };
  const current = load().finally(() => {
    if (catalogueReads.get(pendingKey) === current) catalogueReads.delete(pendingKey);
  });
  if (!refresh) catalogueReads.set(pendingKey, current);
  return current;
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
    const result = await withBudget((signal) => fetchOffers(supplier, country, regionName, signal, true), CATALOGUE_BUDGET_MS);
    return { offers: rankWithinSupplier(result.offers), errorCode: result.partial ? "SERVICE_RESPONSE_INVALID" : null };
  } catch (error) {
    bitcallCatalogueCooldown(error);
    return { offers: [], errorCode: errorCodeOf(error) };
  }
}

/** Do not hammer a shared account after a 429, even from another local caller. */
function bitcallCatalogueCooldown(error: unknown): number | null {
  if (!(error instanceof BitcallError) || !["RATE_LIMITED", "LOCAL_RATE_BUDGET"].includes(error.code)) return null;
  const seconds = error.retryAfterSeconds !== null && Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0
    ? Math.max(1, error.retryAfterSeconds) : 60;
  if (error.code === "RATE_LIMITED") {
    bitcallCatalogueRetryAt = Math.max(bitcallCatalogueRetryAt, Math.min(Number.MAX_SAFE_INTEGER, Date.now() + seconds * 1000));
  }
  return seconds;
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
export async function buyOtpNumber(
  offer: OtpOffer,
  onAccepted?: (providerRequestId: string) => Promise<void> | void,
): Promise<BoughtNumber> {
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
  if (activation.activationId) await onAccepted?.(activation.activationId);
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
    // A definitive refusal means the purchase did not execute and there is no
    // second supplier to try. The ambiguous cases are limited to missing
    // confirmation from a live provider call, not an explicit decline.
    const definitive = new Set([
      "NO_API_KEY",
      "INVALID_BASE_URL",
      "RATE_LIMIT_UNAVAILABLE",
      "RATE_LIMITED",
      "LOCAL_RATE_BUDGET",
      "STALE_CATALOG",
      "OTP_PROVIDER_REFUSED",
      "SERVICE_UNAVAILABLE",
      "COST_UNKNOWN",
      "UNPROFITABLE",
      "OTP_OFFER_STALE",
      "OTP_CONFIRMATION_UNAVAILABLE",
      "INVALID_OTP_SELECTION",
      "OTP_CLAIM_REQUIRED",
    ]);
    return !definitive.has(error.code ?? "");
  }
  if (error instanceof Error && error.name === "BitcallError") return isAmbiguousBitcallOutcome(error);
  // A thrown non-provider value is a bug, not a receipt: assume the worst.
  return true;
}
