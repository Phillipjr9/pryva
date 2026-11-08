import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { esimOfferTerms, findEsimOffer, recheckEsimOffer } from "@/lib/services/esim/esim-catalog";
import { requireUser } from "@/lib/identity/auth";
import { formatNaira } from "@/lib/services/catalog";
import { CountryFlag } from "@/components/CountryFlag";
import { ServiceIcon } from "@/components/ServiceIcon";
import { EsimBuy } from "./EsimBuy";

export const metadata: Metadata = { title: "eSIM plan" };
export const dynamic = "force-dynamic";

function numberStatus(value: boolean | null): string {
  if (value === true) return "Listed as included";
  if (value === false) return "Listed as not included";
  return "Not specified";
}

function capabilityStatus(value: boolean | null): string {
  if (value === true) return "Listed as supported";
  if (value === false) return "Listed as not supported";
  return "Not specified";
}

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

  let listed;
  try {
    listed = await findEsimOffer(id);
  } catch {
    return (
      <div className="grid gap-3">
        <Link href="/dashboard/esim" className="w-fit text-meta font-semibold text-lav-700 hover:underline">← Back to eSIM plans</Link>
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-meta text-amber-900">We couldn&apos;t load this plan right now. Please try again or contact support. Nothing has been charged.</p>
      </div>
    );
  }
  if (!listed) notFound();
  // The single-plan endpoint may add or change details compared with the list.
  // Show those current terms before asking the customer to confirm a purchase.
  const confirmed = await recheckEsimOffer(listed, { browse: true }).catch(() => null);
  const offer = confirmed ?? { ...listed, purchasable: false };

  const countries = offer.countries.slice(0, 24);

  return (
    <div className="grid gap-5">
      <Link href="/dashboard/esim" className="w-fit text-meta font-semibold text-lav-700 hover:underline">
        ← Back to eSIM plans
      </Link>

      <div className="flex items-start gap-3">
        <ServiceIcon service="esim" size="lg" />
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-micro font-bold uppercase tracking-[0.16em] text-lav-700">
            <CountryFlag region={offer.region} size={16} decorative radius={8} />
            <span>{offer.region}</span>
          </div>
          <h1 className="mt-1 text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">{offer.name}</h1>
          <p className="mt-1 text-[0.9rem] text-ink-2">
            {offer.dataLabel} · {offer.validityLabel} · eSIM
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-[1.5rem] border border-line bg-white p-5 lg:col-span-2">
          <h2 className="text-[1.05rem] font-semibold text-ink">What you get</h2>
          <ul className="mt-3 grid gap-2 text-[0.92rem] leading-relaxed text-ink-2">
            <li>• {offer.dataLabel} · {offer.validityLabel}.</li>
            <li>• Install using the activation code on your order. A one-tap link may also be available on compatible devices.</li>
            <li>• Check that your phone supports eSIM and is unlocked before buying.</li>
            <li>• The activation code appears on your order once issued; your wallet is charged when it arrives.</li>
          </ul>

          <h2 className="mt-6 text-[1.05rem] font-semibold text-ink">Plan features and services</h2>
          <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">
            These are the capabilities reported for this specific plan. “Not specified” means the listing did not confirm the feature; do not assume it is included. You cannot choose a specific phone number before buying.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { label: "Phone number", status: numberStatus(offer.includesPhoneNumber) },
              { label: "Calls", status: capabilityStatus(offer.supportsVoice) },
              { label: "SMS", status: capabilityStatus(offer.supportsSms) },
            ].map(({ label, status }) => (
              <div key={label} className="rounded-xl border border-line bg-cream/50 px-3 py-2.5">
                <dt className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</dt>
                <dd className="mt-1 text-meta font-semibold text-ink">{status}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-meta leading-relaxed text-ink-2">
            These details come from the plan listing. We have not confirmed how an included number is provided or any call and SMS charges. If you need a number, calls or SMS, <Link href="/contact" className="font-semibold text-lav-700 underline underline-offset-2">contact support</Link> before buying.
          </p>

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
            <p className="mt-2 text-[0.9rem] text-ink-2">Coverage is not listed. <Link href="/contact" className="font-semibold text-lav-700 underline underline-offset-2">Contact support</Link> before buying.</p>
          )}
        </section>

        <aside className="flex h-fit flex-col gap-3 rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">{confirmed ? "Price" : "Last listed price"}</p>
            <p className="mt-1 text-[1.6rem] font-semibold tracking-tight text-ink">{formatNaira(offer.priceNgn)}</p>
          </div>
          <p className="text-meta leading-relaxed text-ink-2">A specific phone number cannot be selected for this eSIM.</p>
          {!confirmed ? <p role="status" className="text-meta leading-relaxed text-amber-800">Current plan details and price could not be confirmed. Reload this page or contact support before buying.</p> : null}
          <EsimBuy
            offerId={offer.id}
            name={offer.name}
            price={offer.priceNgn}
            expectedTerms={esimOfferTerms(offer)}
            balance={user.walletBalance}
            purchasable={offer.purchasable}
          />
        </aside>
      </div>
    </div>
  );
}
