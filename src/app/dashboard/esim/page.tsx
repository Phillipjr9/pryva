import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ServiceTitle } from "@/components/ServiceTitle";
import { formatDateNigerian } from "@/lib/date-utils";
import { catalogueItems, ESIM_CATALOGUE_LIMIT, readEsimCatalog } from "@/lib/esim-catalog";
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

  try {
    const catalog = await readEsimCatalog();
    items = catalogueItems(catalog.offers);
    total = catalog.offers.length;
    fetchedAt = catalog.fetchedAt;
    partial = catalog.partial;
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

      {failure ? (
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
