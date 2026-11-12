import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { readSupplierSnapshot, supplierItemsForCountry } from "@/lib/services/numbers/fleexa-catalog";
import { isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import { boostItems, readBoostSnapshot } from "@/lib/services/boosts/smm-catalog";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import { esimItemsForAllDestinations, esimItemsForCountry, ESIM_CATALOGUE_LIMIT, readEsimCatalog } from "@/lib/services/esim/esim-catalog";
import { explorerCountry } from "@/lib/services/service-explorer";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { retryAfterReset } from "@/lib/platform/retry-after";
import { CatalogueReadTimeout, withCatalogueReadTimeout } from "@/lib/platform/catalogue-read-timeout";
import { logger } from "@/lib/platform/logger";
import { isFundingFailure } from "@/lib/providers/types";
import { readOtpOffersForSupplier } from "@/lib/services/numbers/otp-suppliers";
import { bitcallOtpItemsForCountry, otpCatalogProviderError } from "@/lib/services/numbers/otp-catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// Individual provider requests may take 20 seconds, a shared cold snapshot can
// wait 30 seconds for another instance, and eSIM pagination can take two rounds.
// A 15-second outer guard reported healthy but slow reads as outages. The whole
// request also has a budget, including auth and rate limiting, so a cold database
// cannot push this read past the platform's 60-second function limit.
const SUPPLIER_READ_TIMEOUT_MS = 45_000;
const REQUEST_WORK_BUDGET_MS = 55_000;
type Feed = "numbers" | "social" | "esim" | "verification";

function preflightUnavailable(stage: "authentication" | "rate-limit", error: unknown) {
  logger.warn("Live catalogue request unavailable", {
    stage, reason: error instanceof CatalogueReadTimeout ? "timeout" : "outage",
  });
  return NextResponse.json({ error: "Catalog temporarily unavailable", reason: "unavailable" }, {
    status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "30" },
  });
}

async function attempt<T>(feed: Feed, configured: boolean, timeoutMs: number, read: () => Promise<T>): Promise<Source<T>> {
  if (!configured) return { configured: false, snapshot: null, failure: null };
  const startedAt = Date.now();
  try {
    return { configured: true, snapshot: await withCatalogueReadTimeout(read, timeoutMs), failure: null };
  } catch (error) {
    const funding = isFundingFailure(error);
    // Operationally distinguish our deadline from a provider refusal without
    // logging raw provider bodies, customer IDs, URLs or credentials.
    logger.warn("Live catalogue feed unavailable", {
      feed, reason: funding ? "funding" : error instanceof CatalogueReadTimeout ? "timeout" : "outage",
      elapsedMs: Date.now() - startedAt,
    });
    return { configured: true, snapshot: null, failure: funding ? "funding" : "outage" };
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
  const deadline = Date.now() + REQUEST_WORK_BUDGET_MS;
  const remaining = () => Math.max(0, deadline - Date.now());
  async function withinBudget<T>(read: () => Promise<T>): Promise<T> {
    const timeout = remaining();
    if (!timeout) throw new CatalogueReadTimeout();
    return withCatalogueReadTimeout(read, timeout);
  }

  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try { user = await withinBudget(getCurrentUser); }
  catch (error) { return preflightUnavailable("authentication", error); }
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const country = explorerCountry(request.nextUrl.searchParams.get("country"));
  if (!country) return NextResponse.json({ error: "Choose a valid country" }, { status: 400 });

  const requestedFeed = request.nextUrl.searchParams.get("feed");
  const allDestinations = request.nextUrl.searchParams.get("allDestinations") === "1";
  const validFeeds = ["esim", "numbers", "social", "verification"] as const;
  if (requestedFeed && !(validFeeds as readonly string[]).includes(requestedFeed)) {
    return NextResponse.json({ error: "Choose a valid feed" }, { status: 400 });
  }
  if (allDestinations && requestedFeed !== "esim") {
    return NextResponse.json({ error: "All destinations is supported only for eSIM" }, { status: 400 });
  }

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

  const requestedFeeds = requestedFeed ? [requestedFeed] : [...validFeeds];
  const feedBudgetKeys = [...requestedFeeds].sort().map((feed) => `supplier-catalog:${user.id}:${feed}`);
  let limits: Awaited<ReturnType<typeof catalogRateLimiter>>[];
  try { limits = await withinBudget(() => Promise.all(feedBudgetKeys.map((key) => catalogRateLimiter(key)))); }
  catch (error) { return preflightUnavailable("rate-limit", error); }
  const unavailable = limits.find((limit) => limit.unavailable);
  if (unavailable) {
    return NextResponse.json({ error: "Catalog temporarily unavailable", reason: "unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "30" } });
  }
  const throttled = limits.filter((limit) => !limit.allowed);
  if (throttled.length) return NextResponse.json({ error: "Please try again shortly", reason: "throttled" }, {
    status: 429,
    headers: { "Cache-Control": "private, no-store", "Retry-After": retryAfterReset(Math.max(...throttled.map((limit) => limit.resetTime))) },
  });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const readBudget = Math.min(SUPPLIER_READ_TIMEOUT_MS, remaining());
  if (!readBudget) return preflightUnavailable("rate-limit", new CatalogueReadTimeout());
  const readSocial = () => attempt("numbers", isFleexaConfigured(), readBudget, () => readSupplierSnapshot(refresh));
  const readBoost = () => attempt("social", isSmmPanelConfigured(), readBudget, () => readBoostSnapshot(refresh));
  const readEsim = () => attempt("esim", isBitcallConfigured(), readBudget, () => readEsimCatalog(refresh));
  let otpRetryAfter: number | null = null;
  const readOtp = () => attempt("verification", isBitcallConfigured(), readBudget, async () => {
    const read = await readOtpOffersForSupplier("bitcall", country.code, country.name, undefined, refresh);
    if (read.errorCode === "RATE_LIMITED" || read.errorCode === "LOCAL_RATE_BUDGET") {
      otpRetryAfter = read.retryAfterSeconds ?? 60;
    }
    if (read.errorCode && read.offers.length === 0) throw otpCatalogProviderError(read.errorCode);
    return { offers: read.offers, partial: read.partial ?? false, degraded: read.degraded ?? null, fetchedAt: read.fetchedAt ?? null };
  });

  let supplier: Source<Awaited<ReturnType<typeof readSupplierSnapshot>>> | null = null;
  let boost: Source<Awaited<ReturnType<typeof readBoostSnapshot>>> | null = null;
  let esim: Source<Awaited<ReturnType<typeof readEsimCatalog>>> | null = null;
  let otp: Source<{ offers: Awaited<ReturnType<typeof readOtpOffersForSupplier>>["offers"]; partial: boolean; degraded: "funding" | "outage" | null; fetchedAt: string | null; }> | null = null;

  [supplier, boost, esim, otp] = await Promise.all([
    (!requestedFeed || requestedFeed === "numbers") ? readSocial() : null,
    (!requestedFeed || requestedFeed === "social") ? readBoost() : null,
    (!requestedFeed || requestedFeed === "esim") ? readEsim() : null,
    (!requestedFeed || requestedFeed === "verification") ? readOtp() : null,
  ]);

  const sources = [supplier, boost, esim, otp].filter((source): source is NonNullable<typeof source> => source !== null);
  // Include the name with each status: the aggregate request's feed order is
  // not the same as source order. No customer identifiers or provider data.
  logger.info("CATALOG_ROUTE_SOURCE_STATUS", {
    requestedFeed,
    sources: ([
      { feed: "numbers", source: supplier },
      { feed: "social", source: boost },
      { feed: "esim", source: esim },
      { feed: "verification", source: otp },
    ] as const).flatMap(({ feed, source }) => source ? [{
      feed,
      configured: source.configured,
      hasSnapshot: Boolean(source.snapshot),
      failure: source.failure,
      partial: Boolean(source.snapshot?.partial),
    }] : []),
  });

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
    // Preserve an upstream account cooldown; a browser retry must not restart
    // a paginated supplier walk before the provider allows it.
    if (requestedFeed === "verification" && otpRetryAfter !== null) {
      return NextResponse.json(
        { error: "Please try again shortly", reason: "throttled" },
        { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(otpRetryAfter) } },
      );
    }
    // Configured but unreachable: this one *is* transient, and retrying works.
    return NextResponse.json(
      { error: "The live catalog is temporarily unavailable", reason: "unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": String(Math.max(10, otpRetryAfter ?? 0)) } },
    );
  }

  if (allDestinations && requestedFeed === "esim" && esim) {
    const items = esim.snapshot ? esimItemsForAllDestinations(esim.snapshot.listings) : [];
    const unreadable = Boolean(esim.snapshot && esim.snapshot.stats && esim.snapshot.stats.returned > 0 && esim.snapshot.listings.length === 0);
    const truncated = Boolean(esim.snapshot && esim.snapshot.listings.length > ESIM_CATALOGUE_LIMIT);
    const partial = unreadable || truncated || Boolean(esim.snapshot?.partial);
    return NextResponse.json(
      {
        ok: true,
        country: country.code,
        live: true,
        reason: partial ? "partial" : null,
        partial,
        truncated,
        unreadable,
        fetchedAt: esim.snapshot?.fetchedAt ?? null,
        items,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const items = [
    ...(supplier?.snapshot ? supplierItemsForCountry(supplier.snapshot, country.code) : []),
    ...(otp?.snapshot ? bitcallOtpItemsForCountry(otp.snapshot.offers, country.code, country.name) : []),
    ...(esim?.snapshot ? esimItemsForCountry(esim.snapshot.listings, country.code) : []),
    ...(boost?.snapshot ? boostItems(boost.snapshot) : []),
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
  const partial = gaps.length > 0;
  // Incomplete, and every gap is a funding gap: still not retryable.
  const fundingGap = partial && gaps.every((gap) => gap === "funding");
  const fetchedAt = sources
    .map((source) => source.snapshot?.fetchedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .pop() ?? null;

  return NextResponse.json(
    { ok: true, country: country.code, live: true, reason: fundingGap ? "funding" : partial ? "partial" : null, partial, fetchedAt, items },
    { headers: { "Cache-Control": "private, no-store", ...(otpRetryAfter !== null ? { "Retry-After": String(otpRetryAfter) } : {}) } },
  );
}
