import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { financialActionsUnavailable } from "@/lib/financial-environment";
import { ServiceTitle } from "@/components/ServiceTitle";
import { formatDateNigerian } from "@/lib/date-utils";
import { catalogueItems, ESIM_CATALOGUE_LIMIT, readEsimCatalog, type EsimCatalogStats } from "@/lib/esim-catalog";
import { EsimCatalogue } from "./EsimCatalogue";

export const metadata: Metadata = { title: "eSIM plans" };
export const dynamic = "force-dynamic";

/**
 * The whole eSIM catalogue in one list.
 *
 * The service explorer is per-destination by design: it answers "what can I buy
 * for Nigeria", never "what is there". That made a large catalogue look like a
 * short one, and there was no page anywhere that showed the catalogue as a
 * catalogue. This page shows the bounded supplier snapshot, including plans
 * without a safe price, searchable by region and destination. Incomplete reads
 * are labelled; plans without a safe quote are never sellable.
 *
 * It reads the catalogue directly rather than through `/api/services/catalog`,
 * because that route is per-country and rate-limited per customer; a page that
 * shows everything should not spend a country lookup to do it.
 */
export default async function EsimCataloguePage() {
  await requireUser("/dashboard/esim");

  let items: ReturnType<typeof catalogueItems> = [];
  let total = 0;
  let fetchedAt: string | null = null;
  let partial = false;
  let failure: string | null = null;
  let stats: EsimCatalogStats | null = null;
  let unpriced = 0;

  try {
    const catalog = await readEsimCatalog();
    items = catalogueItems(catalog.listings);
    total = catalog.listings.length;
    unpriced = catalog.listings.filter((listing) => listing.priceNgn === null).length;
    fetchedAt = catalog.fetchedAt;
    partial = catalog.partial;
    stats = catalog.stats;
  } catch (error) {
    // "Not configured" and "the supplier is down" are different, and only one of
    // them is the owner's to fix, so they are not collapsed into one message.
    failure = financialActionsUnavailable()
      ? "eSIM ordering is unavailable in this environment."
      : error instanceof Error && /not configured/i.test(error.message)
        ? "eSIM ordering is not connected yet, so no plan can be bought."
        : "The eSIM catalogue could not be read just now.";
  }

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="esim">eSIM plans</ServiceTitle>
        <p className="mt-1 text-[0.86rem] leading-relaxed text-ink-2">
          Browse current plans by data allowance, validity and naira price. Availability can change;
          your wallet is charged when the profile is issued. You cannot select a specific phone number
          when ordering an eSIM.
        </p>
      </div>

      {!failure && total === 0 ? (
        /*
         * An empty list used to render as the catalogue component's own
         * "No plan matches that" screen with a "Clear filters" button: a search
         * that was never applied. The customer could not tell an empty
         * catalogue from a broken filter, so "the listing is empty" was the
         * only thing they could report. Say which of the two it is.
         */
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.86rem] leading-relaxed text-amber-900">
          <p className="font-semibold">No eSIM plan is on sale right now.</p>
          <p className="mt-1">
            {stats && stats.returned > 0
              ? "Plans were returned, but their details could not be read. Please try again later or contact support."
              : "No plans are currently listed. Coverage and availability can change."}
            {partial ? " The plan list was incomplete when it was read, so this may be temporary." : ""}
            {" "}You have not been charged.
          </p>
        </div>
      ) : failure ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.86rem] leading-relaxed text-amber-900">
          {failure}{" "}
          <Link href="/dashboard/services?category=esim" className="font-semibold underline">
            Browse by destination instead
          </Link>
          .
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-meta text-ink-3">
            {total} {total === 1 ? "plan" : "plans"} listed
            {total > ESIM_CATALOGUE_LIMIT ? ` · showing the cheapest ${ESIM_CATALOGUE_LIMIT}` : ""}
            {fetchedAt ? ` · read ${formatDateNigerian(fetchedAt, { short: true, includeTime: true })}` : ""}
            {partial ? " · the plan list may be incomplete" : ""}
          </p>
          {unpriced > 0 ? (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-meta leading-relaxed text-amber-900">
              {unpriced === 1 ? "One plan has" : `${unpriced} plans have`} no confirmed naira price and cannot be bought right now.
            </p>
          ) : null}
          <EsimCatalogue items={items} truncated={total > ESIM_CATALOGUE_LIMIT} />
        </>
      )}
      <p className="text-micro text-ink-3">
        <a href="https://www.exchangerate-api.com" className="underline underline-offset-2">Rates By Exchange Rate API</a>
      </p>
    </div>
  );
}
