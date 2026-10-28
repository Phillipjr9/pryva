import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { digitalServices, getDigitalService } from "@/lib/digital-services";
import { formatNaira } from "@/lib/catalog";
import { DigitalServicesForm } from "./DigitalServicesForm";
import { ServiceIcon } from "@/components/ServiceIcon";
import { ArrowRight, Shield } from "@/components/icons";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { demoDigitalInventory } from "@/lib/demo-digital";
import { explorerCountry } from "@/lib/service-explorer";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

export default async function DigitalServicesPage({
  searchParams,
}: {
  // Next 16 hands searchParams over as a promise. This page used to read it
  // synchronously, so `?service=…` never matched and the detail view was
  // unreachable — the whole section was a dead end from the dashboard.
  searchParams: Promise<{ service?: string | string[]; country?: string | string[] }>;
}) {
  const user = await requireUser("/dashboard/digital");
  const query = await searchParams;
  const selectedService = typeof query.service === "string" ? getDigitalService(query.service) : null;
  const country = explorerCountry(query.country);
  // A bad deep link must not silently render or purchase a different service.
  if ((query.service !== undefined && !selectedService) || (query.country !== undefined && !country)) notFound();
  const allSubscriptions = country ? `/dashboard/digital?country=${country.code}` : "/dashboard/digital";
  const preview = isPreviewDatabase();
  const inventory = preview ? demoDigitalInventory(user.id) : {};

  return (
    <div className="grid gap-4">
      {country && <Link href={`/dashboard/services?country=${country.code}&category=subscriptions`} className="w-fit text-[0.78rem] font-semibold text-lav-700 hover:underline">← Back to subscription services</Link>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
            {selectedService ? selectedService.name : "Premium subscriptions"}
          </h1>
          <p className="mt-1 max-w-xl text-[0.86rem] text-ink-2">
            {preview ? "Explore fictional subscription plans and try a demo checkout." : selectedService
              ? "Compare catalog plans. Live fulfillment is paused."
              : "Explore subscription examples. Live fulfillment is paused."}
          </p>
          {country && <p className="mt-1 text-[0.73rem] text-ink-3">Browsing for {country.name}. This selection does not confirm real coverage.{preview && " Demo subscription stock and owned units are shared across browsing countries."}</p>}
        </div>
        {selectedService ? (
          <Link
            href={allSubscriptions}
            className="btn border border-line bg-white !px-3.5 !py-2 !text-[0.76rem] text-ink hover:border-lav-200"
          >
            All subscriptions
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-[0.68rem] text-ink-3">
            <Shield className="h-3 w-3 text-lav-600" /> Wallet balance {formatNaira(user.walletBalance)}
          </span>
        )}
      </div>

      {selectedService ? (
        <DigitalServicesForm key={`${selectedService.slug}:${country?.code ?? ""}`} user={user} service={selectedService} preview={preview} inventory={inventory} countryCode={country?.code} backHref={allSubscriptions} />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {digitalServices.map((service) => (
            <Link
              key={service.slug}
              href={`/dashboard/digital?service=${encodeURIComponent(service.slug)}${country ? `&country=${country.code}` : ""}`}
              className="group flex flex-col rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 transition-all hover:-translate-y-0.5 hover:border-lav-200 hover:shadow-[var(--shadow-card)]"
            >
              <div className="flex items-start gap-3">
                <ServiceIcon service={service.slug as never} size="md" />
                <div className="min-w-0">
                  <h2 className="truncate text-[0.95rem] font-semibold text-ink">{service.name}</h2>
                  <p className="text-[0.7rem] text-ink-3">
                    {service.plans.length} plan{service.plans.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-2">
                {preview ? "Fictional subscription demo; no account access." : "Country coverage unconfirmed."}
              </p>
              <div className="mt-3"><UnitsStatus demo={preview} stock={preview ? service.plans.reduce((sum, plan) => sum + (inventory[plan.id]?.stock ?? 0), 0) : null} owned={preview ? service.plans.reduce((sum, plan) => sum + (inventory[plan.id]?.owned ?? 0), 0) : null} /></div>
              <div className="mt-auto flex items-end justify-between gap-2 pt-3.5">
                <div>
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-ink-3">{preview ? "Demo from" : "Preview from"}</p>
                  <p className="text-[0.95rem] font-semibold text-ink">
                    {formatNaira(Math.min(...service.plans.map((plan) => plan.price)))}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[0.74rem] font-semibold text-lav-700">
                  Choose plan <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
