import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { findPlan } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";
import { canPreviewPlan, explorerCountry } from "@/lib/service-explorer";
import { CountryFlag } from "@/components/CountryFlag";
import { PlanPurchase } from "@/components/purchase/PlanPurchase";

export const metadata: Metadata = { title: "Plan details" };
export const dynamic = "force-dynamic";

export default async function DashboardPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ country?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser("/dashboard/services");
  const country = explorerCountry(query.country);
  const plan = findPlan(slug);
  if (!country || !plan || !canPreviewPlan(plan, country.code)) notFound();

  const category = plan.service === "email-otp" ? "email" : plan.service;
  const back = `/dashboard/services?country=${country.code}&category=${category}`;

  /**
   * The fulfilment allowlist is the single source of truth for what can be sold.
   * A plan outside it has no supplier path, so this page offers no way to pay for
   * it — the same rule `/api/orders` enforces server-side.
   */
  const fulfillable = isPlanFulfillable(plan.slug);

  return (
    <div className="grid gap-5">
      <Link href={back} className="w-fit text-meta font-semibold text-lav-700 hover:underline">← Back to services</Link>
      <div>
        <p className="flex items-center gap-2 text-meta font-semibold uppercase tracking-[0.14em] text-lav-700">
          <CountryFlag code={country.code} size={20} decorative radius={10} /> {country.name} selected
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold text-ink">{plan.name}</h1>
        <p className="mt-1 text-[0.84rem] text-ink-2">{plan.planLabel} · {plan.duration}</p>
      </div>

      {fulfillable ? (
        <>
          <div role="note" className="rounded-2xl border border-line bg-white p-4 text-meta leading-relaxed text-ink-2">
            Delivered automatically once payment is taken from your wallet. Your verification code
            appears in the order details as soon as it arrives.
          </div>
          <PlanPurchase
            groups={[{ label: plan.planLabel, plans: [plan] }]}
            signedIn
            walletBalance={user.walletBalance}
            nextPath={back}
          />
        </>
      ) : (
        <>
          <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-meta leading-relaxed text-amber-900">
            This plan cannot be delivered yet, so it cannot be ordered or charged.
          </div>
          <div className="rounded-2xl border border-line bg-white p-6 text-[0.84rem] text-ink-2">
            <Link href="/virtual-numbers" className="font-semibold text-lav-700 hover:underline">
              See the number plans available now →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
