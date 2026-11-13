import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { explorerCountry } from "@/lib/services/service-explorer";
import { findOtpCheckoutOffer } from "@/lib/services/numbers/otp-catalog";
import { PlanPurchase } from "@/components/purchase/PlanPurchase";

export const metadata: Metadata = { title: "App verification checkout" };
export const dynamic = "force-dynamic";

export default async function AppOtpCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ country?: string | string[]; from?: string | string[] }>;
}) {
  const [{ offerId }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser("/dashboard/services");
  const country = explorerCountry(query.country);
  // The return target is an allowlisted shelf, never an arbitrary URL.
  const backCategory = query.from === "numbers" ? "numbers" : "verification";
  if (!country || !/^otp-[a-f0-9]{24}$/.test(offerId)) {
    return <Unavailable countryCode={country?.code ?? null} backCategory={backCategory} />;
  }

  const { listing } = await findOtpCheckoutOffer(country.code, offerId);
  const back = `/dashboard/services?country=${country.code}&category=${backCategory}`;
  if (!listing) return <Unavailable countryCode={country.code} backCategory={backCategory} />;

  const purchasePlan = {
    ...listing.plan,
    name: listing.app,
    planLabel: `${listing.app} · ${listing.countryName} single-use verification`,
  };

  return (
    <div className="grid gap-5">
      <Link href={back} className="w-fit text-meta font-semibold text-lav-700 hover:underline">← Back to services</Link>
      <div>
        <p className="flex items-center gap-2 text-meta font-semibold uppercase tracking-[0.14em] text-lav-700">
          {listing.countryName} · app verification
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold text-ink">{listing.app}</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-2">Single-use SMS number · {listing.plan.duration}</p>
      </div>

      {listing.purchasable ? (
        <>
          <div role="note" className="rounded-2xl border border-line bg-white p-4 text-meta leading-relaxed text-ink-2">
            This live app offer is rechecked before purchase. If the listing changes or delivery is uncertain,
            the order is held for review and your wallet is not charged.
          </div>
          <PlanPurchase
            textOnly
            groups={[{ label: purchasePlan.planLabel, plans: [purchasePlan] }]}
            signedIn
            userId={user.id}
            walletBalance={user.walletBalance}
            nextPath={back}
            otpOfferId={listing.id}
          />
        </>
      ) : (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-meta leading-relaxed text-amber-900">
          This app offer is no longer sellable at the listed price. No order was created and your wallet was not charged.
        </div>
      )}
    </div>
  );
}

function Unavailable({ countryCode, backCategory }: { countryCode: string | null; backCategory: "numbers" | "verification" }) {
  const back = countryCode ? `/dashboard/services?country=${countryCode}&category=${backCategory}` : "/dashboard/services";
  return (
    <div className="grid gap-4">
      <Link href={back} className="w-fit text-meta font-semibold text-lav-700 hover:underline">← Back to services</Link>
      <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-meta leading-relaxed text-amber-900">
        This app offer could not be confirmed from the live catalogue. It cannot be ordered or charged.
      </div>
    </div>
  );
}
