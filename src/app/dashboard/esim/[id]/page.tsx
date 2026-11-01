import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { findEsimOffer } from "@/lib/esim-catalog";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/catalog";
import { ServiceIcon } from "@/components/ServiceIcon";
import { EsimBuy } from "./EsimBuy";

export const metadata: Metadata = { title: "eSIM plan" };
export const dynamic = "force-dynamic";

/**
 * One live eSIM plan.
 *
 * The offer is resolved from the catalogue by its hashed reference, so this page
 * can only ever show a plan that is currently listed and priced — a stale link
 * 404s instead of quoting a price that no longer exists.
 */
export default async function EsimPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard/esim");
  const { id } = await params;

  const offer = await findEsimOffer(id).catch(() => null);
  if (!offer) notFound();

  const countries = offer.countries.slice(0, 24);

  return (
    <div className="grid gap-5">
      <Link href="/dashboard/esim" className="w-fit text-meta font-semibold text-lav-700 hover:underline">
        ← Back to eSIM plans
      </Link>

      <div className="flex items-start gap-3">
        <ServiceIcon service="esim" size="lg" />
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">{offer.region}</p>
          <h1 className="mt-1 text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">{offer.name}</h1>
          <p className="mt-1 text-[0.9rem] text-ink-2">
            {offer.dataLabel} · {offer.validityLabel} · data-only eSIM
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-[1.5rem] border border-line bg-white p-5 lg:col-span-2">
          <h2 className="text-[1.05rem] font-semibold text-ink">What you get</h2>
          <ul className="mt-3 grid gap-2 text-[0.92rem] leading-relaxed text-ink-2">
            <li>• {offer.dataLabel} on arrival, valid for {offer.validityLabel.toLowerCase()}.</li>
            <li>• Installed from an activation code or the one-tap install link on your order — no shop visit.</li>
            <li>• Data-only: your usual number stays active for calls and messages.</li>
            <li>• The profile is issued the moment you buy; if issuing takes a moment, you are charged only once it arrives.</li>
          </ul>

          <h2 className="mt-6 text-[1.05rem] font-semibold text-ink">
            {offer.coverage === "not-country-specific" ? "Where it works" : "Coverage"}
          </h2>
          {countries.length ? (
            <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">
              {countries.join(", ")}
              {offer.countries.length > countries.length
                ? ` and ${offer.countries.length - countries.length} more`
                : ""}
              .
            </p>
          ) : (
            <p className="mt-2 text-[0.9rem] text-ink-2">Coverage is confirmed by the network when you install the profile.</p>
          )}
        </section>

        <aside className="flex h-fit flex-col gap-3 rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">Price</p>
            <p className="mt-1 text-[1.6rem] font-semibold tracking-tight text-ink">{formatNaira(offer.priceNgn)}</p>
          </div>
          <EsimBuy
            offerId={offer.id}
            name={offer.name}
            price={offer.priceNgn}
            balance={user.walletBalance}
            purchasable={offer.purchasable}
          />
        </aside>
      </div>
    </div>
  );
}
