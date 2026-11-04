import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
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
 * catalogue. This is that page: every plan the supplier publishes and we can
 * price, sorted by price, searchable, filterable by region, with the ones the
 * margin guard refuses still listed but not sellable.
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
  let shown = 0;

  try {
    const catalog = await readEsimCatalog();
    items = catalogueItems(catalog.offers);
    total = catalog.offers.length;
    fetchedAt = catalog.fetchedAt;
    partial = catalog.partial;
    stats = catalog.stats;
    shown = items.length;
  } catch (error) {
    // "Not configured" and "the supplier is down" are different, and only one of
    // them is the owner's to fix, so they are not collapsed into one message.
    failure = error instanceof Error && /not configured/i.test(error.message)
      ? "eSIM ordering is not connected yet, so no plan can be bought."
      : "The eSIM catalogue could not be read just now.";
  }

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="esim">eSIM plans</ServiceTitle>
        <p className="mt-1 text-[0.86rem] leading-relaxed text-ink-2">
          Every plan the network is offering right now, cheapest first — data allowance, validity and the
          naira price. You are charged when the profile is issued.
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
            Nothing is available to buy at the moment. That is a shortage on our side, not a
            destination we do not cover — you have not been charged, and trying again in a few
            minutes is safe.
            {partial ? " The plan list was also incomplete when it was read, so this may be temporary." : ""}
          </p>
        </div>
      ) : total > 0 && shown === 0 && stats && stats.priced > 0 ? (
        /*
         * Plans exist but none survived the price cut. "Sold out" and "we cannot
         * price it" look identical in a list, and only one of them is worth
         * waiting for, so the reason is stated rather than a bare empty grid.
         */
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.86rem] leading-relaxed text-amber-900">
          {stats.priced} plan{stats.priced === 1 ? " was" : "s were"} found but none can be sold at a
          price we can stand behind. Nothing was charged.
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
            {partial ? " · coverage may be incomplete" : ""}
          </p>
          <EsimCatalogue items={items} truncated={total > ESIM_CATALOGUE_LIMIT} />
        </>
      )}
    </div>
  );
}
