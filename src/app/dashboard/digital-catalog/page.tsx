import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { DigitalCatalogBrowser } from "./DigitalCatalogBrowser";
import { AvailableDigitalProducts } from "./AvailableDigitalProducts";
import { listedCodeOffers } from "@/lib/services/foxreload/code-orders";
import { listedTopupOffers } from "@/lib/services/foxreload/topup-orders";
import { listedEsimOffers } from "@/lib/services/foxreload/esim-orders";
import { starsSalesConfigured } from "@/lib/services/foxreload/stars-orders";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";

export const dynamic = "force-dynamic";

export default async function DigitalCatalogPage() {
  await requireUser("/dashboard/digital-catalog");
  const canSell = !financialActionsUnavailable();
  const offers = canSell ? [
    ...listedCodeOffers().map(({ id, name, region }) => ({ id, name, region, kind: "codes" as const })),
    ...listedTopupOffers().map(({ id, name, region }) => ({ id, name, region, kind: "topups" as const })),
    ...listedEsimOffers().map(({ id, name, region }) => ({ id, name, region, kind: "esims" as const })),
  ] : [];
  return (
    <div className="grid gap-5">
      <Link href="/dashboard/services" className="w-fit text-meta font-semibold text-lav-700 underline">← Service hub</Link>
      <div>
        <h1 className="text-[1.6rem] font-semibold text-ink">Explore digital products</h1>
        <p className="mt-2 text-[0.9rem] text-ink-2">Browse or search the digital catalogue, including subscriptions, gaming products, telecom and more.</p>
      </div>
      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-meta text-amber-900">
        Catalogue listings do not confirm price, coverage or availability. Only reviewed products link to a separate quote before payment.
      </div>
      <AvailableDigitalProducts offers={offers} starsEnabled={canSell && starsSalesConfigured()} />
      <h2 className="text-xl font-semibold text-ink">Explore the full catalogue</h2>
      <DigitalCatalogBrowser />
    </div>
  );
}
