import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { findPlan } from "@/lib/catalog";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { canPreviewPlan, explorerCountry } from "@/lib/service-explorer";
import { CountryFlag } from "@/components/CountryFlag";

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
  await requireUser("/dashboard/services");
  const country = explorerCountry(query.country);
  const plan = findPlan(slug);
  if (!country || !plan || !canPreviewPlan(plan, country.code)) notFound();

  const category = plan.service === "email-otp" ? "email" : plan.service;
  const back = `/dashboard/services?country=${country.code}&category=${category}`;
  const preview = isPreviewDatabase();
  if (preview) redirect(`/dashboard/services/demo/plan-${encodeURIComponent(slug)}?country=${country.code}`);

  return (
    <div className="grid gap-5">
      <Link href={back} className="w-fit text-[0.78rem] font-semibold text-lav-700 hover:underline">← Back to services</Link>
      <div>
        <p className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
          <CountryFlag code={country.code} size={20} decorative radius={10} /> {country.name} selected
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold text-ink">{plan.name}</h1>
        <p className="mt-1 text-[0.84rem] text-ink-2">{plan.planLabel} · {plan.duration}</p>
      </div>
      <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-[0.78rem] leading-relaxed text-amber-900">
        Supplier stock is unknown and remaining service units are not tracked. This catalog region does not confirm live coverage.
        {" "}Live fulfillment is paused, so this plan cannot be purchased.
      </div>
      <div className="rounded-2xl border border-line bg-white p-6 text-[0.84rem] text-ink-2">
        Live ordering will remain unavailable until the supplier integration and coverage are verified.
      </div>
    </div>
  );
}
