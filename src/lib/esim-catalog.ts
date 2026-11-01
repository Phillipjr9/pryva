import "server-only";
import { createHash } from "node:crypto";

import { isBitcallConfigured, listBitcallEsimCountries, listBitcallEsimPlans, type BitcallEsimPlan } from "@/lib/bitcall";
import { getUsdToNgnRate } from "@/lib/exchange-rate";
import { logger } from "@/lib/logger";
import { checkMargin } from "@/lib/margin-guard";
import { priceFromCost } from "@/lib/pricing";
import { explorerCountry, type ExplorerItem } from "@/lib/service-explorer";

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
  /** Wholesale cost in naira. Never rendered to a customer. */
  costNgn: number;
  priceNgn: number;
  /** False when the margin guard would refuse the sale at this price. */
  purchasable: boolean;
};

export type EsimCatalog = {
  offers: EsimOffer[];
  partial: boolean;
  fetchedAt: string;
};

type EsimSnapshot = {
  plans: BitcallEsimPlan[];
  countries: string[];
  partial: boolean;
  fetchedAt: string;
};

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
    const [plans, countries] = await Promise.allSettled([listBitcallEsimPlans(), listBitcallEsimCountries()]);
    // The plan catalog is the product; without it there is nothing to show.
    // The country list only annotates coverage, so it degrades instead.
    if (plans.status === "rejected") throw new Error("eSIM catalog unavailable");
    const snapshot: EsimSnapshot = {
      plans: plans.value.slice(0, 2000),
      countries: countries.status === "fulfilled" ? countries.value.slice(0, 400) : [],
      partial: countries.status === "rejected",
      fetchedAt: new Date().toISOString(),
    };
    snapshotCache = { snapshot, expires: Date.now() + 30_000 };
    return snapshot;
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

function dataLabel(plan: BitcallEsimPlan): string {
  if (plan.allowance && plan.allowanceUnit) return `${plan.allowance}${plan.allowanceUnit} of data`;
  return "Travel data";
}

function validityLabel(plan: BitcallEsimPlan): string {
  if (plan.validity && plan.validityUnit) return `${plan.validity} ${plan.validityUnit}`;
  if (plan.validity) return `${plan.validity} days`;
  return "Validity as stated by the supplier";
}

/**
 * The supplier bills in its own currency; we sell in naira.
 *
 * Only the currencies we can convert honestly are sold: a plan priced in
 * something this deployment has no rate for is listed as unavailable-to-buy
 * rather than guessed at. An absent currency is read as USD, which is what the
 * supplier quotes in.
 */
async function costNgnFor(plan: BitcallEsimPlan): Promise<number | null> {
  if (plan.price === null || !Number.isFinite(plan.price) || plan.price <= 0) return null;
  const currency = (plan.currency ?? "USD").toUpperCase();
  if (currency === "NGN") return Math.round(plan.price);
  if (currency !== "USD") {
    logger.warn("eSIM plan skipped: unsupported supplier currency", { currency });
    return null;
  }
  const { rate } = await getUsdToNgnRate();
  const converted = Math.round(plan.price * rate);
  return converted > 0 ? converted : null;
}

async function offerFromPlan(plan: BitcallEsimPlan): Promise<EsimOffer | null> {
  // The client already refuses anything without its `pln_` prefix, but the
  // catalogue re-checks: a plan that cannot be bought must not be listed with a
  // price, whatever upstream let through.
  if (!plan.planId || !plan.planId.startsWith("pln_")) return null;
  const costNgn = await costNgnFor(plan);
  if (costNgn === null) return null;

  const quote = priceFromCost(costNgn, { service: "esim" });
  const margin = checkMargin(quote.priceNgn, quote.costNgn);

  return {
    id: esimOfferId(plan.planId),
    planId: plan.planId,
    name: readable(plan.name) ?? "eSIM data plan",
    region: readable(plan.region, 40) ?? "Travel",
    countries: plan.countries,
    dataLabel: dataLabel(plan),
    validityLabel: validityLabel(plan),
    coverage: /\b(?:global|world|worldwide)\b/i.test(`${plan.region ?? ""} ${plan.name ?? ""}`)
      ? "not-country-specific"
      : "catalog-country",
    costNgn: quote.costNgn,
    priceNgn: quote.priceNgn,
    purchasable: margin.ok,
  };
}

/**
 * Every plan the catalogue can sell, priced once and reused for 30 seconds.
 *
 * A single unconvertible plan must not take the catalogue down with it: each
 * plan is priced independently and one that cannot be is left out.
 */
export async function readEsimCatalog(refresh = false): Promise<EsimCatalog> {
  if (!refresh && catalogCache && catalogCache.expires > Date.now()) return catalogCache.catalog;
  if (catalogInFlight) return catalogInFlight;
  catalogInFlight = (async () => {
    const snapshot = await readEsimSnapshot(refresh);
    const offers: EsimOffer[] = [];
    const seen = new Set<string>();
    for (const plan of snapshot.plans) {
      let offer: EsimOffer | null = null;
      try {
        offer = await offerFromPlan(plan);
      } catch (error) {
        logger.warn("eSIM plan could not be priced", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!offer || seen.has(offer.id)) continue;
      seen.add(offer.id);
      offers.push(offer);
    }
    // Cheapest first: the catalogue is browsed by price, and a page of plans
    // sorted by whatever order the supplier returned is unreadable.
    offers.sort((a, b) => a.priceNgn - b.priceNgn || a.name.localeCompare(b.name));
    const catalog: EsimCatalog = { offers, partial: snapshot.partial, fetchedAt: snapshot.fetchedAt };
    catalogCache = { catalog, expires: Date.now() + 30_000 };
    return catalog;
  })();
  try {
    return await catalogInFlight;
  } finally {
    catalogInFlight = null;
  }
}

/**
 * Resolve a hashed reference back to the live offer.
 *
 * This is the only way a checkout learns a plan id: ids come from the catalogue
 * above, so a client cannot name a plan that is not currently listed, and the
 * price is the one this module computed — never one supplied with the request.
 */
export async function findEsimOffer(id: string): Promise<EsimOffer | null> {
  if (typeof id !== "string" || !/^live-esim-[a-f0-9]{20}$/.test(id)) return null;
  const { offers } = await readEsimCatalog();
  return offers.find((offer) => offer.id === id) ?? null;
}

/** A plan covers a country only when the catalog says so explicitly. */
function coversCountry(plan: EsimOffer, code: string, name: string): boolean {
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
 * Listings for one destination.
 *
 * A regional plan is never shown against a country it does not name: guessing
 * coverage advertises service that may not exist there. Global plans are shown
 * everywhere, labelled as such.
 *
 * Stock is null because eSIM plans report no inventory; availability is answered
 * at purchase time, and an unknown must not render as zero.
 */
export function esimItemsForCountry(offers: EsimOffer[], countryCode: string): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  const items: ExplorerItem[] = [];

  for (const offer of offers) {
    const covered = coversCountry(offer, country.code, country.name);
    const global = !covered && offer.coverage === "not-country-specific";
    if (!covered && !global) continue;

    items.push({
      id: offer.id,
      category: "esim",
      name: offer.name,
      description: `${offer.dataLabel} · ${offer.validityLabel}`,
      tag: offer.region,
      artwork: { kind: "service", name: "esim" },
      source: "live",
      coverage: covered ? "catalog-country" : "not-country-specific",
      stock: null,
      myUnits: null,
      price: offer.priceNgn,
      // An unpurchasable plan is still worth listing — it is a real destination —
      // but it gets no button rather than a button that fails.
      action: offer.purchasable
        ? { label: "Buy eSIM", href: `/dashboard/esim/${encodeURIComponent(offer.id)}` }
        : null,
    });
  }
  return items;
}
