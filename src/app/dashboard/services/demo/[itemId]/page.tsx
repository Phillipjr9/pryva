import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { demoInventory, demoService } from "@/lib/demo-services";
import { demoServicePresentation } from "@/lib/demo-service-presentation";
import { BrandIcon } from "@/components/BrandIcon";
import { CountryFlag } from "@/components/CountryFlag";
import { ServiceIcon } from "@/components/ServiceIcon";
import { NetworkBadge } from "@/components/NetworkBadge";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { DemoServiceCheckout } from "@/components/dashboard/DemoServiceCheckout";

export const metadata: Metadata = { title: "Demo service" };
export const dynamic = "force-dynamic";

export default async function DemoServicePage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ country?: string | string[] }> }) {
  if (!isPreviewDatabase()) notFound();
  const user = await requireUser("/dashboard/services");
  const [{ itemId }, query] = await Promise.all([params, searchParams]);
  const selection = typeof query.country === "string" ? demoService(itemId, query.country) : null;
  if (!selection) notFound();
  const { item, terms, country } = selection;
  const presentation = demoServicePresentation(selection);
  if (!presentation) notFound();
  const counts = demoInventory(user.id, country.code)[item.id] ?? { stock: 0, owned: 0 };
  const back = `/dashboard/services?country=${country.code}&category=${item.category}`;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <Link href={back} className="w-fit text-[0.78rem] font-semibold text-lav-700 hover:underline">← Back to {presentation.category}</Link>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-start">
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <section className="relative overflow-hidden rounded-[1.5rem] border border-lav-200 bg-[#f6f1fc] p-6 sm:p-8">
            <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-lav-300/30 blur-3xl" />
            <div className="relative">
              <p className="flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.15em] text-lav-700"><CountryFlag code={country.code} size={20} decorative radius={10} /> {country.name} · {presentation.category} demo</p>
              <div className="mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-sm">
                {item.artwork.kind === "brand" ? <BrandIcon brand={item.artwork.name} size={42} decorative /> : item.artwork.kind === "service" ? <ServiceIcon service={item.artwork.name} size="md" /> : <NetworkBadge provider={item.artwork.name} size={40} />}
              </div>
              <h1 className="mt-4 text-[1.65rem] font-semibold leading-tight text-ink">{item.name}</h1>
              <p className="mt-2 text-[0.84rem] leading-relaxed text-ink-2">{presentation.description}</p>
              <dl className="mt-5 grid grid-cols-2 gap-2">
                {presentation.facts.map((fact) => <div key={fact.label} className="min-w-0 rounded-xl border border-white/80 bg-white/70 px-3 py-2.5">
                  <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-ink-3">{fact.label}</dt>
                  <dd className="mt-1 break-words text-[0.78rem] font-semibold leading-snug text-ink">{fact.value}</dd>
                </div>)}
              </dl>
              <div className="mt-5"><UnitsStatus demo stock={counts.stock} owned={counts.owned} /></div>
              <p className="mt-3 text-[0.72rem] leading-relaxed text-ink-3">These are fictional demo units. The selected country and catalog region do not confirm real stock or coverage.</p>
            </div>
          </section>
          <section aria-labelledby="demo-delivery-title" className="rounded-[1.5rem] border border-line bg-white p-5 sm:p-6">
            <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-lav-700">What happens next</p>
            <h2 id="demo-delivery-title" className="mt-2 text-[1rem] font-semibold text-ink">{presentation.deliveryTitle}</h2>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-2">{presentation.deliveryDescription}</p>
          </section>
        </div>
        <DemoServiceCheckout key={`${country.code}:${item.id}`} itemId={item.id} country={country.code} name={item.name} price={terms.price} balance={user.walletBalance} stock={counts.stock} units={terms.units} summary={presentation.checkoutSummary} delivery={presentation.checkoutDelivery} />
      </div>
    </div>
  );
}
