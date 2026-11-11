import "server-only";
import { createHash } from "node:crypto";

import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { getBitcallEsimPlan, isBitcallConfigured, listBitcallEsimCountries, listBitcallEsimPlans, type BitcallEsimPlan } from "@/lib/providers/bitcall";
import { isFundingFailure } from "@/lib/providers/types";
import { getFreshNgnRate, type NgnQuoteCurrency } from "@/lib/payments/exchange-rate";
import { logger } from "@/lib/platform/logger";
import { checkMargin } from "@/lib/services/margin-guard";
import { priceFromCost } from "@/lib/services/pricing";
import { explorerCountry, type ExplorerItem } from "@/lib/services/service-explorer";

/**
 * The eSIM catalogue, priced and ready to sell.
 *
 * The supplier lists plans worldwide with a per-plan price and currency; this
 * module turns that feed into offers Pryva can actually honour: a naira cost, a
 * selling price inside the margin band, and a margin check against the same
 * floor every other live purchase clears. A plan that cannot be priced is not
 * listed as purchasable, because "we don't know what it costs" is not a price.
 */

export type EsimOffer = {
  /** Opaque, stable per plan — the only form of the supplier's id a page sees. */
  id: string;
  /** Provider reference. Server-only; resolved back from `id` at checkout. */
  planId: string;
  name: string;
  region: string;
  countries: string[];
  dataLabel: string;
  validityLabel: string;
  coverage: "catalog-country" | "not-country-specific";
  /** Plan-listing information, not a guarantee that a number is delivered by this integration. */
  includesPhoneNumber: boolean | null;
  supportsVoice: boolean | null;
  supportsSms: boolean | null;
  /** Wholesale cost in naira. Never rendered to a customer. */
  costNgn: number;
  priceNgn: number;
  /** False when the margin guard would refuse the sale at this price. */
  purchasable: boolean;
};

/** The read-only listing stays visible even when a safe quote is unavailable. */
export type EsimListing = Omit<EsimOffer, "costNgn" | "priceNgn" | "purchasable"> & {
  priceNgn: number | null;
  purchasable: boolean;
};

/**
 * Why a catalogue came out the size it did.
 *
 * "The list is too short" is unanswerable from the outside: a plan the supplier
 * never published, a plan we could not price and a plan whose coverage we could
 * not read all look identical on the page. These counters are the difference
 * between a guess and a fact, and the admin diagnostics endpoint reports them.
 */
export type EsimCatalogStats = {
  /** Rows the supplier returned. */
  returned: number;
  /** Plans that became an offer. */
  priced: number;
  /** Rows with no usable plan reference. */
  skippedNoPlanId: number;
  /** Listings with no usable supplier price. */
  skippedNoPrice: number;
  /** Listings with an absent or unsupported currency. */
  skippedCurrency: number;
  /** Listings whose supported currency has no current conversion rate. */
  skippedRate: number;
  /** Offers that share a hashed id with an earlier one. */
  duplicates: number;
  /** Listings with a named destination; the rest are global or unreadable. */
  withCoverage: number;
  /** Offers shown under every destination because the catalog calls them global. */
  global: number;
  /** Offers the margin guard allows to be sold. */
  purchasable: number;
};

export type EsimCatalog = {
  /** Only priced offers are usable for checkout. */
  offers: EsimOffer[];
  /** Includes real plans that cannot currently be priced, without a buy action. */
  listings: EsimListing[];
  partial: boolean;
  /** Why the catalogue is incomplete, when it is; null when it is whole. */
  degraded?: "funding" | "outage" | null;
  fetchedAt: string;
  stats: EsimCatalogStats;
};

type PriceOutcome =
  | { costNgn: number }
  | { skip: "no-price" | "unsupported-currency" | "rate-unavailable" };

type EsimSnapshot = {
  plans: BitcallEsimPlan[];
  countries: string[];
  returned: number;
  unreadable: number;
  partial: boolean;
  /** "funding" cannot be retried away; "outage" can. Null when the read is whole. */
  degraded: "funding" | "outage" | null;
  fetchedAt: string;
};

const CATALOG_TTL_MS = 2 * 60_000;
let snapshotCache: { expires: number; snapshot: EsimSnapshot } | null = null;
let snapshotInFlight: Promise<EsimSnapshot> | null = null;
let catalogCache: { expires: number; catalog: EsimCatalog } | null = null;
let catalogInFlight: Promise<EsimCatalog> | null = null;

/** A short-lived, process-local read cache; the shared gateway budget still protects the credential across instances. */
async function readEsimSnapshot(refresh = false): Promise<EsimSnapshot> {
  if (!isBitcallConfigured()) throw new Error("eSIM provider not configured");
  if (!refresh && snapshotCache && snapshotCache.expires > Date.now()) return snapshotCache.snapshot;
  if (snapshotInFlight) return snapshotInFlight;
  snapshotInFlight = (async () => {
    try {
      const [plans, countries] = await Promise.allSettled([listBitcallEsimPlans(), listBitcallEsimCountries()]);
      // The plan catalog is the product; without it there is nothing to show.
      // The country list only annotates coverage, so it degrades instead.
      // Keep an unfunded-account refusal intact: it is not an outage.
      if (plans.status === "rejected") {
        if (isFundingFailure(plans.reason)) throw plans.reason;
        throw new Error("eSIM catalog unavailable");
      }
      // A local budget limit is not evidence that products disappeared upstream.
      // Retain a recent complete snapshot, preserving its original age and marking degradation.
      if (plans.value.partial && plans.value.partialReason === "budget" && snapshotCache &&
          !snapshotCache.snapshot.partial && Date.now() - Date.parse(snapshotCache.snapshot.fetchedAt) < 5 * 60_000) {
        return { ...snapshotCache.snapshot, partial: true, degraded: "outage" as const };
      }
      const snapshot: EsimSnapshot = {
        plans: plans.value.plans,
        countries: countries.status === "fulfilled" ? countries.value.slice(0, 400) : [],
        returned: plans.value.returned,
        unreadable: plans.value.unreadable,
        partial: plans.value.partial || countries.status === "rejected",
        degraded: countries.status === "fulfilled" && !plans.value.partial
          ? null
          : countries.status === "rejected" && isFundingFailure(countries.reason) ? "funding" : "outage",
        fetchedAt: new Date().toISOString(),
      };
      snapshotCache = { snapshot, expires: Date.now() + CATALOG_TTL_MS };
      return snapshot;
    } catch (error) {
      if (snapshotCache && Date.now() - Date.parse(snapshotCache.snapshot.fetchedAt) < 5 * 60_000) {
        const stale = { ...snapshotCache.snapshot, partial: true, degraded: "outage" as const, fetchedAt: snapshotCache.snapshot.fetchedAt };
        snapshotCache = { snapshot: stale, expires: Date.now() + CATALOG_TTL_MS };
        return stale;
      }
      throw error;
    }
  })();
  try {
    return await snapshotInFlight;
  } finally {
    snapshotInFlight = null;
  }
}

/** Rejects provider text, and anything naming the source, before it can reach a customer. */
function readable(value: string | null, max = 70): string | null {
  if (typeof value !== "string") return null;
  const result = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!result || result.length > max) return null;
  if (/bitcall/i.test(result)) return null;
  return result;
}

/** Plan references are hashed; the provider's own identifiers never reach the browser. */
export function esimOfferId(planId: string): string {
  return `live-esim-${createHash("sha256").update(`esim\0${planId}`).digest("hex").slice(0, 20)}`;
}

/** A public, non-secret fingerprint of the plan terms shown at checkout. */
export function esimOfferTerms(offer: EsimOffer): string {
  return createHash("sha256").update(JSON.stringify({
    id: offer.id,
    name: offer.name,
    region: offer.region,
    dataLabel: offer.dataLabel,
    validityLabel: offer.validityLabel,
    coverage: offer.coverage,
    countries: [...offer.countries].sort(),
    includesPhoneNumber: offer.includesPhoneNumber,
    supportsVoice: offer.supportsVoice,
    supportsSms: offer.supportsSms,
  })).digest("hex").slice(0, 24);
}

function dataLabel(plan: BitcallEsimPlan): string {
  if (plan.unlimitedData === true) return "Unlimited data";
  const unit = readable(plan.allowanceUnit, 12);
  if (plan.allowance && unit) return `${plan.allowance}${unit} of data`;
  return "Travel data";
}

function validityLabel(plan: BitcallEsimPlan): string {
  const unit = readable(plan.validityUnit, 16);
  if (plan.validity && unit) return `${plan.validity} ${unit}`;
  if (plan.validity) return `${plan.validity} days`;
  return "Validity not listed";
}

/** A quote is unavailable, not zero, when a currency rate is missing or stale. */
type ConversionRates = Partial<Record<NgnQuoteCurrency, number | null>>;

async function ratesFor(plans: BitcallEsimPlan[]): Promise<ConversionRates> {
  const needed = new Set(plans.map((plan) => plan.currency?.trim().toUpperCase()));
  const rates: ConversionRates = {};
  await Promise.all((["USD", "EUR"] as const).map(async (currency) => {
    if (!needed.has(currency)) return;
    rates[currency] = (await getFreshNgnRate(currency))?.rate ?? null;
  }));
  return rates;
}

/** The documented catalog amount is what the account pays, in its own currency. */
function costNgnFor(plan: BitcallEsimPlan, rates: ConversionRates): PriceOutcome {
  if (plan.price === null || !Number.isFinite(plan.price) || plan.price <= 0) return { skip: "no-price" };
  const currency = plan.currency?.trim().toUpperCase();
  if (!currency || !["NGN", "USD", "EUR"].includes(currency)) return { skip: "unsupported-currency" };
  const rate = currency === "NGN" ? 1 : rates[currency as NgnQuoteCurrency];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return { skip: "rate-unavailable" };
  // A fractional naira of cost must never be rounded down before the margin check.
  const converted = Math.ceil(plan.price * rate);
  return Number.isSafeInteger(converted) && converted > 0 && converted <= 2_147_483_647
    ? { costNgn: converted }
    : { skip: "no-price" };
}

type ListingFields = Omit<EsimListing, "priceNgn" | "purchasable">;

function listingFromPlan(plan: BitcallEsimPlan): ListingFields | null {
  if (!plan.planId || !/^pln_[A-Za-z0-9_-]{1,128}$/.test(plan.planId)) return null;
  return {
    id: esimOfferId(plan.planId),
    planId: plan.planId,
    name: readable(plan.name) ?? "eSIM data plan",
    region: readable(plan.region, 40) ?? "Travel",
    countries: plan.countries.map((country) => readable(country, 70)).filter((country): country is string => country !== null),
    dataLabel: dataLabel(plan),
    validityLabel: validityLabel(plan),
    coverage: /\b(?:global|world|worldwide)\b/i.test(`${plan.region ?? ""} ${plan.name ?? ""}`)
      ? "not-country-specific"
      : "catalog-country",
    includesPhoneNumber: plan.includesPhoneNumber ?? null,
    supportsVoice: plan.supportsVoice ?? null,
    supportsSms: plan.supportsSms ?? null,
  };
}

type OfferOutcome =
  | { offer: EsimOffer; listing: EsimListing }
  | { listing: EsimListing; skip: "no-price" | "unsupported-currency" | "rate-unavailable" }
  | { skip: "no-plan-id" };

function offerFromPlan(plan: BitcallEsimPlan, rates: ConversionRates): OfferOutcome {
  const listing = listingFromPlan(plan);
  if (!listing) return { skip: "no-plan-id" };
  const priced = costNgnFor(plan, rates);
  if ("skip" in priced) return { listing: { ...listing, priceNgn: null, purchasable: false }, skip: priced.skip };

  const quote = priceFromCost(priced.costNgn, { service: "esim" });
  if (!Number.isSafeInteger(quote.priceNgn) || quote.priceNgn <= 0 || quote.priceNgn > 2_147_483_647) {
    return { listing: { ...listing, priceNgn: null, purchasable: false }, skip: "no-price" };
  }
  const margin = checkMargin(quote.priceNgn, quote.costNgn);
  const offer: EsimOffer = { ...listing, costNgn: quote.costNgn, priceNgn: quote.priceNgn, purchasable: margin.ok };
  return { offer, listing: offer };
}

/**
 * Read a bounded catalogue. Priced offers are distinct from read-only listings:
 * an unknown price or exchange rate must never create a buyable offer.
 */
export async function readEsimCatalog(refresh = false): Promise<EsimCatalog> {
  if (financialActionsUnavailable()) throw new Error("eSIM ordering is unavailable in this environment");
  if (!refresh && catalogCache && catalogCache.expires > Date.now()) return catalogCache.catalog;
  if (catalogInFlight) return catalogInFlight;
  catalogInFlight = (async () => {
    try {
      const snapshot = await readEsimSnapshot(refresh);
      const rates = await ratesFor(snapshot.plans);
      const offers: EsimOffer[] = [];
      const listings: EsimListing[] = [];
      const seen = new Set<string>();
      const stats: EsimCatalogStats = {
        returned: snapshot.returned,
        priced: 0,
        skippedNoPlanId: snapshot.unreadable,
        skippedNoPrice: 0,
        skippedCurrency: 0,
        skippedRate: 0,
        duplicates: 0,
        withCoverage: 0,
        global: 0,
        purchasable: 0,
      };
      for (const plan of snapshot.plans) {
        const outcome = offerFromPlan(plan, rates);
        if (!("listing" in outcome)) {
          stats.skippedNoPlanId += 1;
          continue;
        }
        const listing = outcome.listing;
        if (seen.has(listing.id)) {
          stats.duplicates += 1;
          continue;
        }
        seen.add(listing.id);
        listings.push(listing);
        if ("offer" in outcome) offers.push(outcome.offer);
        else if (outcome.skip === "no-price") stats.skippedNoPrice += 1;
        else if (outcome.skip === "rate-unavailable") stats.skippedRate += 1;
        else stats.skippedCurrency += 1;
      }
      offers.sort((a, b) => a.priceNgn - b.priceNgn || a.name.localeCompare(b.name));
      listings.sort((a, b) => (a.priceNgn ?? Infinity) - (b.priceNgn ?? Infinity) || a.name.localeCompare(b.name));
      stats.priced = offers.length;
      stats.withCoverage = listings.filter((listing) => listing.countries.length > 0).length;
      stats.global = listings.filter((listing) => listing.coverage === "not-country-specific").length;
      stats.purchasable = offers.filter((offer) => offer.purchasable).length;
      logger.debug("eSIM catalogue read", { ...stats, partial: snapshot.partial });
      const catalog: EsimCatalog = { offers, listings, partial: snapshot.partial, degraded: snapshot.degraded, fetchedAt: snapshot.fetchedAt, stats };
      catalogCache = { catalog, expires: Date.now() + CATALOG_TTL_MS };
      return catalog;
    } catch (error) {
      if (catalogCache && Date.now() - Date.parse(catalogCache.catalog.fetchedAt) < 5 * 60_000) {
        const stale = { ...catalogCache.catalog, partial: true, degraded: "outage" as const, fetchedAt: catalogCache.catalog.fetchedAt };
        catalogCache = { catalog: stale, expires: Date.now() + CATALOG_TTL_MS };
        return stale;
      }
      throw error;
    }
  })();
  try {
    return await catalogInFlight;
  } finally {
    catalogInFlight = null;
  }
}

/** Resolve a public hash only against a currently listed, priced offer. */
export async function findEsimOffer(id: string): Promise<EsimOffer | null> {
  if (typeof id !== "string" || !/^live-esim-[a-f0-9]{20}$/.test(id)) return null;
  const { offers } = await readEsimCatalog();
  return offers.find((offer) => offer.id === id) ?? null;
}

/** A fresh per-plan read and margin check immediately before any purchase. */
export async function recheckEsimOffer(offer: EsimOffer, options: { browse?: boolean } = {}): Promise<EsimOffer | null> {
  const plan = await getBitcallEsimPlan(offer.planId, options);
  if (!plan || plan.planId !== offer.planId) return null;
  const outcome = offerFromPlan(plan, await ratesFor([plan]));
  return "offer" in outcome && outcome.offer.id === offer.id ? outcome.offer : null;
}

/** A plan covers a country only when the catalog says so explicitly. */
function coversCountry(plan: EsimListing, code: string, name: string): boolean {
  const wanted = [
    code.toLowerCase(),
    name.toLowerCase(),
    ...(name.includes(",") ? [name.split(",")[0].trim().toLowerCase()] : []),
    ...(name.includes("(") ? [name.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase()] : []),
  ];
  return plan.countries.some((entry) => {
    const value = entry.trim().toLowerCase();
    return (
      wanted.includes(value) ||
      (code === "gb" && value === "uk") ||
      (code === "us" && (value === "usa" || value === "united states of america")) ||
      (code === "ae" && value === "uae")
    );
  });
}

/**
 * The whole catalogue, in the shape a browser may see.
 *
 * `planId` is the provider reference and `costNgn` is what we pay: neither is part
 * of a customer's view of a plan, and this mapper is the only thing that stands
 * between the two, so it is a pure function a test can hold to that.
 */
export type EsimCatalogueItem = {
  id: string;
  name: string;
  region: string;
  dataLabel: string;
  validityLabel: string;
  /** How many destinations the plan names; zero can also mean unknown. */
  destinations: number;
  /** Supplier-reported country codes/names, expanded for destination search. */
  countrySearch: string[];
  global: boolean;
  priceNgn: number | null;
  purchasable: boolean;
  /** Provider-listed capabilities. Null/undefined means the plan did not specify it. */
  includesPhoneNumber?: boolean | null;
  supportsVoice?: boolean | null;
  supportsSms?: boolean | null;
};

/** A page cannot render ten thousand cards, and a price-sorted slice is the honest cut. */
export const ESIM_CATALOGUE_LIMIT = 1_000;

export function catalogueItems(offers: EsimListing[], limit = ESIM_CATALOGUE_LIMIT): EsimCatalogueItem[] {
  return offers.slice(0, limit).map((offer) => ({
    id: offer.id,
    name: offer.name,
    region: offer.region,
    dataLabel: offer.dataLabel,
    validityLabel: offer.validityLabel,
    destinations: offer.countries.length,
    countrySearch: offer.countries.flatMap((country) => {
      const code = country.trim().toLowerCase();
      const canonical = code === "uk" ? "gb" : code === "usa" ? "us" : code === "uae" ? "ae" : code;
      const name = explorerCountry(canonical)?.name;
      return name ? [country, name] : [country];
    }),
    global: offer.coverage === "not-country-specific",
    priceNgn: offer.priceNgn,
    purchasable: offer.purchasable,
    includesPhoneNumber: offer.includesPhoneNumber,
    supportsVoice: offer.supportsVoice,
    supportsSms: offer.supportsSms,
  }));
}

export function esimItemsForAllDestinations(offers: EsimListing[], limit = ESIM_CATALOGUE_LIMIT): ExplorerItem[] {
  return offers.slice(0, limit).map((offer) => ({
    id: offer.id,
    category: "esim",
    name: offer.name,
    description: `${offer.dataLabel} · ${offer.validityLabel}`,
    tag: offer.region,
    artwork: { kind: "service", name: "esim" },
    source: "live",
    coverage: "unconfirmed",
    stock: null,
    myUnits: null,
    price: offer.priceNgn,
    detail: [
      offer.includesPhoneNumber === true ? "Phone included" : null,
      offer.supportsVoice === true ? "Voice listed" : null,
      offer.supportsSms === true ? "SMS listed" : null,
      offer.countries.length > 0 ? `${offer.countries.length} destination${offer.countries.length === 1 ? "" : "s"}` : null,
    ].filter((value): value is string => Boolean(value)).join(" · "),
    searchTerms: offer.countries.flatMap((country) => {
      const code = country.trim().toLowerCase();
      const canonical = code === "uk" ? "gb" : code === "usa" ? "us" : code === "uae" ? "ae" : code;
      return [country, explorerCountry(canonical)?.name ?? ""];
    }).join(" ") || offer.region,
    action: offer.purchasable && offer.priceNgn !== null
      ? { label: "Buy eSIM", href: `/dashboard/esim/${encodeURIComponent(offer.id)}` }
      : null,
  }));
}

/**
 * Listings for one destination.
 *
 * A regional plan is never shown against a country it does not name: guessing
 * coverage advertises service that may not exist there. A global-labelled plan
 * without a country list may be shown, but its country coverage is unconfirmed.
 *
 * Stock is null because eSIM plans report no inventory; availability is answered
 * at purchase time, and an unknown must not render as zero.
 */
export function esimItemsForCountry(offers: EsimListing[], countryCode: string): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  const items: ExplorerItem[] = [];

  for (const offer of offers) {
    const covered = coversCountry(offer, country.code, country.name);
    // A named country list is authoritative even for a "global" plan. If no
    // destinations are supplied, show it with unconfirmed coverage, not as a
    // promise that it works in every country.
    const global = !covered && offer.coverage === "not-country-specific" && offer.countries.length === 0;
    if (!covered && !global) continue;

    items.push({
      id: offer.id,
      category: "esim",
      name: offer.name,
      description: `${offer.dataLabel} · ${offer.validityLabel}`,
      tag: offer.region,
      artwork: { kind: "service", name: "esim" },
      source: "live",
      coverage: covered ? "catalog-country" : "unconfirmed",
      stock: null,
      myUnits: null,
      price: offer.priceNgn,
      // An unpurchasable plan is still worth listing — it is a real destination —
      // but it gets no button rather than a button that fails.
      action: offer.purchasable && offer.priceNgn !== null
        ? { label: "Buy eSIM", href: `/dashboard/esim/${encodeURIComponent(offer.id)}` }
        : null,
    });
  }
  return items;
}
