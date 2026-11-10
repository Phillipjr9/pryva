import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { readSupplierSnapshot, supplierItemsForCountry } from "@/lib/services/numbers/fleexa-catalog";
import { isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import { boostItems, readBoostSnapshot } from "@/lib/services/boosts/smm-catalog";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import { ESIM_CATALOGUE_LIMIT, esimItemsForAllDestinations, esimItemsForCountry, readEsimCatalog } from "@/lib/services/esim/esim-catalog";
import { explorerCountry } from "@/lib/services/service-explorer";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { isFundingFailure } from "@/lib/providers/types";
import { readOtpOffersForSupplier } from "@/lib/services/numbers/otp-suppliers";
import { bitcallOtpItemsForCountry, otpCatalogProviderError } from "@/lib/services/numbers/otp-catalog";

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
type Source<T> = { configured: boolean; snapshot: T | null; failure: "funding" | "outage" | null };

async function attempt<T>(configured: boolean, read: () => Promise<T>): Promise<Source<T>> {
  if (!configured) return { configured: false, snapshot: null, failure: null };
  try {
    return { configured: true, snapshot: await read(), failure: null };
  } catch (error) {
    return { configured: true, snapshot: null, failure: isFundingFailure(error) ? "funding" : "outage" };
  }
}

/**
 * Customer catalogue. App-specific OTP entries are mapped to the Bitcall
 * single-use order flow; eSIM and the other live catalogues retain their own
 * checkout gates.
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

  // A combined request costs one read from every feed. Scope the same 30/min
  // budget per feed so the four independent calls do not quadruple a normal
  // browsing session's rate-limit usage or increase per-feed upstream load.
  const feed = request.nextUrl.searchParams.get("feed");
  const validFeeds = ["numbers", "social", "esim", "verification"];
  if (feed !== null && !validFeeds.includes(feed)) return NextResponse.json({ error: "Invalid catalogue feed" }, { status: 400 });
  const allDestinationsParam = request.nextUrl.searchParams.get("allDestinations");
  if (allDestinationsParam !== null && (allDestinationsParam !== "1" || feed !== "esim")) return NextResponse.json({ error: "Invalid catalogue scope" }, { status: 400 });
  const allDestinations = allDestinationsParam === "1";
  const limits = await Promise.all((feed ? [feed] : validFeeds).map((name) => catalogRateLimiter(`supplier-catalog:${user.id}:${name}`)));
  if (limits.some((limit) => limit.unavailable)) {
    return NextResponse.json({ error: "Catalog temporarily unavailable", reason: "unavailable" }, { status: 503 });
  }
  if (limits.some((limit) => !limit.allowed)) return NextResponse.json({ error: "Please try again shortly", reason: "throttled" }, { status: 429 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  // The optional public category lets the explorer load independent feeds
  // separately. Keep the original combined response for existing callers.
  const include = (name: string) => feed === null || feed === name;
  const [supplier, boost, esim, otp] = await Promise.all([
    attempt(include("numbers") && isFleexaConfigured(), () => readSupplierSnapshot(refresh)),
    attempt(include("social") && isSmmPanelConfigured(), () => readBoostSnapshot(refresh)),
    attempt(include("esim") && isBitcallConfigured(), () => readEsimCatalog(refresh)),
    attempt(include("verification") && isBitcallConfigured(), async () => {
      const read = await readOtpOffersForSupplier("bitcall", country.code, country.name, refresh);
      if (read.errorCode) throw otpCatalogProviderError(read.errorCode);
      return { offers: read.offers, partial: read.stale, degraded: read.stale ? "outage" as const : null, fetchedAt: read.stale ? null : new Date().toISOString() };
    }),
  ]);
  const sources = [supplier, boost, esim, otp];

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
   * Every configured supplier is out of funds. This is not an outage and not a
   * customer's problem: the shop is restocking, and a Retry would be a button
   * that cannot do anything until an operator tops the account up. Answer 200
   * with that reason so the hub can say so plainly.
   */
  const fundingOnly = sources.some((source) => source.configured && !source.snapshot)
    && sources.every((source) => !source.configured || (!source.snapshot && source.failure === "funding"));
  if (sources.every((source) => !source.snapshot)) {
    if (fundingOnly) {
      return NextResponse.json(
        { ok: true, country: country.code, live: false, reason: "funding", partial: false, fetchedAt: null, items: [] },
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
    ...(otp.snapshot ? bitcallOtpItemsForCountry(otp.snapshot.offers, country.code, country.name) : []),
    ...(esim.snapshot ? allDestinations ? esimItemsForAllDestinations(esim.snapshot.listings) : esimItemsForCountry(esim.snapshot.listings, country.code) : []),
    ...(boost.snapshot ? boostItems(boost.snapshot) : []),
  ];
  // Partial means "this may be incomplete": a configured source that failed, or
  // one that reported its own degraded read. A source that is simply not
  // configured is the steady state, not a warning.
  const gaps: Array<"funding" | "outage"> = [];
  for (const source of sources) {
    if (!source.configured) continue;
    if (!source.snapshot) gaps.push(source.failure ?? "outage");
    else if (source.snapshot.partial) gaps.push(source.snapshot.degraded ?? "outage");
  }
  const truncated = allDestinations && !!esim.snapshot && esim.snapshot.listings.length > ESIM_CATALOGUE_LIMIT;
  const unreadable = allDestinations && !!esim.snapshot && esim.snapshot.listings.length === 0 && (esim.snapshot.stats?.returned ?? 0) > 0;
  const partial = gaps.length > 0 || truncated || unreadable;
  // Incomplete solely because of funding is not retryable.
  const fundingGap = !truncated && !unreadable && gaps.length > 0 && gaps.every((gap) => gap === "funding");
  const fetchedAt = sources
    .map((source) => source.snapshot?.fetchedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .pop() ?? null;

  return NextResponse.json(
    { ok: true, country: country.code, live: true, reason: fundingGap ? "funding" : partial ? "partial" : null, partial, ...(truncated ? { truncated: true } : {}), ...(unreadable ? { unreadable: true } : {}), fetchedAt, items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
