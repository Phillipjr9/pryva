import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/identity/auth";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { explorerCategory, explorerCountry } from "@/lib/services/service-explorer";
import { readServiceReadiness } from "@/lib/services/service-readiness";
import { legacyBrandGiftCardSalesEnabled } from "@/lib/services/gift-cards/brand-readiness";
import { legacyGiftCardItems } from "@/lib/services/gift-cards/explorer-items";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { listedCodeOffers } from "@/lib/services/foxreload/code-orders";
import { listedTopupOffers } from "@/lib/services/foxreload/topup-orders";
import { listedEsimOffers } from "@/lib/services/foxreload/esim-orders";
import { starsSalesConfigured } from "@/lib/services/foxreload/stars-orders";
import { reviewedDigitalItems } from "@/lib/services/reviewed-digital-items";

export const metadata: Metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";

export default async function DashboardServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[]; category?: string | string[]; allDestinations?: string | string[] }>;
}) {
  const params = await searchParams;
  const country = typeof params.country === "string" ? params.country : null;
  const category = typeof params.category === "string" ? params.category : null;
  const next = new URLSearchParams();
  if (country && explorerCountry(country)) next.set("country", country);
  if (category && explorerCategory(category) !== "all") next.set("category", category);
  if (category === "esim" && params.allDestinations === "1") next.set("allDestinations", "1");
  await requireUser(`/dashboard/services${next.size ? `?${next}` : ""}`);
  // Legacy category links lead to the same account browser as the sidebar.
  // Account coverage is not country-filtered, so do not pretend to carry it.
  if (category === "accounts") redirect("/dashboard/accounts");
  const canSell = !financialActionsUnavailable();
  const reviewed = reviewedDigitalItems(canSell ? [
    ...listedCodeOffers().map(({ id, name, region }) => ({ id, name, region, kind: "codes" as const })),
    ...listedTopupOffers().map(({ id, name, region }) => ({ id, name, region, kind: "topups" as const })),
    ...listedEsimOffers().map(({ id, name, region }) => ({ id, name, region, kind: "esims" as const })),
  ] : [], canSell && starsSalesConfigured());
  const readiness = readServiceReadiness();
  // An unrecognisable link value falls back to the picker rather than 404ing,
  // but the fallback must be visible: silently showing a different selection is
  // how somebody ends up ordering for the wrong country.
  const rejectedCountry = country && !explorerCountry(country) ? country : null;
  const rejectedCategory = category && explorerCategory(category) === "all" ? category : null;
  // Category links in the shell may navigate between queries on this same page.
  // A new key resets local filters when the server delivers a new selection.
  return (
    <ServiceExplorer
      key={`${country ?? ""}:${category ?? ""}:${params.allDestinations === "1"}`}
      initialAllEsimDestinations={category === "esim" && params.allDestinations === "1"}
      initialCountry={country}
      initialCategory={category}
      rejectedCountry={rejectedCountry}
      rejectedCategory={rejectedCategory}
      readiness={readiness}
      reviewedItems={[...reviewed, ...legacyGiftCardItems(legacyBrandGiftCardSalesEnabled())]}
      enableDigitalCatalogue
    />
  );
}
