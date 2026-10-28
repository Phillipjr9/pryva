import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { demoInventory, demoService } from "@/lib/demo-services";
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
  const counts = demoInventory(user.id, country.code)[item.id] ?? { stock: 0, owned: 0 };
  const back = `/dashboard/services?country=${country.code}&category=${item.category}`;

  return (
    <div className="grid gap-5">
      <Link href={back} className="w-fit text-[0.78rem] font-semibold text-lav-700 hover:underline">← Back to services</Link>
      <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr] lg:items-start">
        <section className="relative overflow-hidden rounded-[1.5rem] border border-lav-200 bg-[#f6f1fc] p-6 sm:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-lav-300/30 blur-3xl" />
          <div className="relative">
            <p className="flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.15em] text-lav-700"><CountryFlag code={country.code} size={20} decorative radius={10} /> {country.name} · Demo service</p>
            <div className="mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-sm">
              {item.artwork.kind === "brand" ? <BrandIcon brand={item.artwork.name} size={42} decorative /> : item.artwork.kind === "service" ? <ServiceIcon service={item.artwork.name} size="md" /> : <NetworkBadge provider={item.artwork.name} size={40} />}
            </div>
            <h1 className="mt-4 text-[1.65rem] font-semibold leading-tight text-ink">{item.name}</h1>
            <p className="mt-2 text-[0.84rem] leading-relaxed text-ink-2">{item.description} · {item.tag}</p>
            <div className="mt-6"><UnitsStatus demo stock={counts.stock} owned={counts.owned} /></div>
            <p className="mt-3 text-[0.72rem] leading-relaxed text-ink-3">These are fictional demo units. They do not represent real supplier stock or platform coverage.</p>
          </div>
        </section>
        <DemoServiceCheckout itemId={item.id} country={country.code} name={item.name} price={terms.price} units={terms.units} balance={user.walletBalance} stock={counts.stock} category={item.category} />
      </div>
    </div>
  );
}
