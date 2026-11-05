import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { readSupplierSnapshot, supplierItemsForCountry } from "@/lib/services/numbers/fleexa-catalog";
import { isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import { boostItems, readBoostSnapshot } from "@/lib/services/boosts/smm-catalog";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import { esimItemsForCountry, readEsimCatalog } from "@/lib/services/esim/esim-catalog";
import { explorerCountry } from "@/lib/services/service-explorer";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { classifyProviderFailure, type ProviderGap } from "@/lib/providers/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A configured supplier that returned nothing, versus one that is not
 * configured at all — and, when it returned nothing, why.
 *
 * `failure` is the difference between "we are out of funds" (top up: retrying
 * changes nothing) and "the feed is down" (retry). The read used to swallow
 * both into `null`, which is how an unfunded account became an endless
 * "couldn't load, Retry" banner.
 */
/**
 * A gap a customer can do nothing about.
 *
 * Funding and a broken credential are both permanent from the shop's side: the
 * next click returns exactly the same answer. Only `outage` is worth a Retry.
 */
const PERMANENT_GAPS: ReadonlySet<ProviderGap> = new Set(["funding", "configuration"]);

type Source<T> = { configured: boolean; snapshot: T | null; failure: ProviderGap | null };

async function attempt<T>(configured: boolean, read: () => Promise<T>): Promise<Source<T>> {
  if (!configured) return { configured: false, snapshot: null, failure: null };
  try {
    return { configured: true, snapshot: await read(), failure: null };
  } catch (error) {
    return { configured: true, snapshot: null, failure: classifyProviderFailure(error) };
  }
}

/** Why the catalogue is incomplete, in the customer's terms, or null for an outage. */
function gapReason(gaps: ProviderGap[]): "funding" | "configuration" | null {
  if (gaps.length === 0 || !gaps.every((gap) => PERMANENT_GAPS.has(gap))) return null;
  // Funding first: it is the one an operator fixes by topping up, and its copy is
  // true of both ("we are restocking").
  return gaps.includes("funding") ? "funding" : "configuration";
}

/**
 * Read-only catalog. Live purchases remain disabled until mappings, pricing and
 * reconciliation are verified.
 *
 * Each supplier is attempted independently. A deployment with only one key
 * configured must still serve that supplier's listings, so one supplier being
 * absent or unreachable degrades the response instead of failing it; only when
 * every configured supplier fails is the catalog unavailable.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const country = explorerCountry(request.nextUrl.searchParams.get("country"));
  if (!country) return NextResponse.json({ error: "Choose a valid country" }, { status: 400 });

  /**
   * "This deployment does not show live availability" is not a failure.
   *
   * It used to be a 404, which the hub can only render as "something broke,
   * retry" — and no retry could ever help, because the reason is the
   * environment, not the request. It answers 200 with `live: false` and a
   * reason, so the page can say what is actually going on and drop the button.
   * No supplier is contacted either way.
   */
  if (financialActionsUnavailable()) {
    return NextResponse.json(
      { ok: true, country: country.code, live: false, reason: "environment", partial: false, fetchedAt: null, items: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const limit = await catalogRateLimiter(`supplier-catalog:${user.id}`);
  if (limit.unavailable) {
    return NextResponse.json({ error: "Catalog temporarily unavailable", reason: "unavailable" }, { status: 503 });
  }
  if (!limit.allowed) return NextResponse.json({ error: "Please try again shortly", reason: "throttled" }, { status: 429 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const [supplier, boost, esim] = await Promise.all([
    attempt(isFleexaConfigured(), () => readSupplierSnapshot(refresh)),
    attempt(isSmmPanelConfigured(), () => readBoostSnapshot(refresh)),
    attempt(isBitcallConfigured(), () => readEsimCatalog(refresh)),
  ]);
  const sources = [supplier, boost, esim];

  /**
   * No supplier connected is the steady state of a fresh deployment, not an
   * incident: the catalogue is still browsable and the hub should say so
   * plainly instead of offering a Retry that will keep returning this.
   */
  if (!sources.some((source) => source.configured)) {
    return NextResponse.json(
      { ok: true, country: country.code, live: false, reason: "unconfigured", partial: false, fetchedAt: null, items: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  /**
   * Nothing to serve, but not because anything is broken: every configured
   * supplier is either unfunded or set up wrong. Neither heals by retrying, so a
   * Retry button here would be a promise the shop cannot keep — answer 200 with
   * the reason and let the hub say which of the two it is.
   */
  const absent: ProviderGap[] = sources.filter((source) => source.configured && !source.snapshot).map((source) => source.failure ?? "outage");
  const permanent = gapReason(absent);
  if (sources.every((source) => !source.snapshot)) {
    if (permanent) {
      return NextResponse.json(
        { ok: true, country: country.code, live: false, reason: permanent, partial: false, fetchedAt: null, items: [] },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    // Configured but unreachable: this one *is* transient, and retrying works.
    return NextResponse.json(
      { error: "The live catalog is temporarily unavailable", reason: "unavailable" },
      { status: 503 },
    );
  }

  const items = [
    ...(supplier.snapshot ? supplierItemsForCountry(supplier.snapshot, country.code) : []),
    ...(esim.snapshot ? esimItemsForCountry(esim.snapshot.listings, country.code) : []),
    ...(boost.snapshot ? boostItems(boost.snapshot) : []),
  ];
  // Partial means "this may be incomplete": a configured source that failed, or
  // one that reported its own degraded read. A source that is simply not
  // configured is the steady state, not a warning.
  const gaps: ProviderGap[] = [];
  for (const source of sources) {
    if (!source.configured) continue;
    if (!source.snapshot) gaps.push(source.failure ?? "outage");
    else if (source.snapshot.partial) gaps.push(source.snapshot.degraded ?? "outage");
  }
  const partial = gaps.length > 0;
  // Incomplete for a reason no retry can fix: funding or a broken credential.
  const permanentGap = gapReason(gaps);
  const fetchedAt = sources
    .map((source) => source.snapshot?.fetchedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .pop() ?? null;

  return NextResponse.json(
    { ok: true, country: country.code, live: true, reason: permanentGap ?? (partial ? "partial" : null), partial, fetchedAt, items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
