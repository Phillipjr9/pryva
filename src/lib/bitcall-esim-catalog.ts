import "server-only";
import { createHash } from "node:crypto";
import { isBitcallConfigured, listBitcallEsimCountries, listBitcallEsimPlans, type BitcallEsimPlan } from "@/lib/bitcall";
import { explorerCountry } from "@/lib/service-explorer";
import type { ExplorerItem } from "@/lib/service-explorer";

export type EsimSnapshot = {
  plans: BitcallEsimPlan[];
  countries: string[];
  partial: boolean;
  fetchedAt: string;
};

let cache: { expires: number; snapshot: EsimSnapshot } | null = null;
let inFlight: Promise<EsimSnapshot> | null = null;

/** A short-lived, process-local read cache; the shared gateway budget still protects the credential across instances. */
export async function readEsimSnapshot(refresh = false): Promise<EsimSnapshot> {
  if (!isBitcallConfigured()) throw new Error("eSIM provider not configured");
  if (!refresh && cache && cache.expires > Date.now()) return cache.snapshot;
  if (inFlight) return inFlight;
  inFlight = (async () => {
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
    cache = { snapshot, expires: Date.now() + 30_000 };
    return snapshot;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

/** Rejects provider text, and anything naming the source, before it can reach a customer. */
function readable(value: string | null, max = 70): string | null {
  if (typeof value !== "string") return null;
  const result = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!result || result.length > max) return null;
  if (/bitcall/i.test(result)) return null;
  return result;
}

/** A plan covers a country only when the catalog says so explicitly. */
function coversCountry(plan: BitcallEsimPlan, code: string, name: string): boolean {
  const wanted = [code.toLowerCase(), name.toLowerCase()];
  return plan.countries.some((entry) => {
    const value = entry.trim().toLowerCase();
    return wanted.includes(value) || (code === "gb" && value === "uk") || (code === "us" && (value === "usa" || value === "united states of america"));
  });
}

function isGlobalRegion(plan: BitcallEsimPlan): boolean {
  return /\b(?:global|world|worldwide)\b/i.test(plan.region ?? "");
}

/** Plan references are hashed; the provider's own identifiers never reach the browser. */
function itemId(planId: string): string {
  return `live-esim-${createHash("sha256").update(`esim\0${planId}`).digest("hex").slice(0, 20)}`;
}

function planTag(plan: BitcallEsimPlan): string {
  const region = readable(plan.region, 24);
  return region ?? "eSIM";
}

/**
 * Only plans whose coverage the catalog states explicitly are displayed for a
 * country, plus plans whose region is stated as global. A regional plan is not
 * shown against a country it does not name: guessing coverage would advertise
 * service that may not exist there.
 *
 * Price is null on every listing, deliberately. Their catalog is documented as
 * returning plans "at your selling prices", which does not settle whether that
 * figure is our cost (needing markup, as Fleexa's does) or a suggested retail
 * price (needing none). Applying a markup to a retail price, or selling at cost,
 * are both expensive mistakes, so the figure is surfaced nowhere until the owner
 * confirms which it is against a real key. Action is null for the same reason as
 * elsewhere: ordering is not wired.
 *
 * Stock is null because eSIM plans report no inventory; availability is answered
 * at purchase time by PRODUCT_UNAVAILABLE, and an unknown must not render as zero.
 */
export function esimItemsForCountry(snapshot: EsimSnapshot, countryCode: string): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  const items: ExplorerItem[] = [];
  const ids = new Set<string>();

  for (const plan of snapshot.plans) {
    if (!plan.planId) continue;
    const covered = coversCountry(plan, country.code, country.name);
    const global = !covered && isGlobalRegion(plan);
    if (!covered && !global) continue;

    const id = itemId(plan.planId);
    if (ids.has(id)) continue;
    ids.add(id);

    const name = readable(plan.name) ?? "eSIM data plan";
    items.push({
      id,
      category: "esim",
      name,
      description: "Travel data plan",
      tag: planTag(plan),
      artwork: { kind: "service", name: "esim" },
      source: "live",
      coverage: covered ? "catalog-country" : "not-country-specific",
      stock: null,
      myUnits: null,
      price: null,
      action: null,
    });
  }
  return items;
}
