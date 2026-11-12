import type { Metadata } from "next";
import Link from "next/link";
import { ServiceIcon } from "@/components/ServiceIcon";

export const metadata: Metadata = {
  title: "Residential Proxies",
  description: "Browse live residential proxy plans by country and state.",
};

export default function ProxiesPage() {
  return (
    <main className="min-h-screen bg-cream">
      <section className="shell py-16 sm:py-20">
        <div className="max-w-3xl">
          <ServiceIcon service="proxies" size="lg" className="mb-5" />
          <p className="mb-3 text-meta font-semibold uppercase tracking-widest text-lav-700">Residential proxies</p>
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem]">Live proxy plans, checked before purchase</h1>
          <p className="mt-6 text-[1.125rem] leading-relaxed text-ink-2">
            Sign in to load current plans and supported countries from the supplier. Choose a country and state, review the current naira price, then extract each purchased IP when you are ready to activate it. Slots last up to six hours.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/login?next=%2Fdashboard%2Fproxies" className="rounded-xl bg-lav-700 px-6 py-3 font-semibold text-white hover:bg-lav-800">View live proxy plans</Link>
            <Link href="/status" className="rounded-xl border border-line bg-white px-6 py-3 font-semibold text-ink hover:bg-cream">Service status</Link>
          </div>
          <p className="mt-5 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-meta leading-relaxed text-amber-900">
            Prices and availability are fetched from the connected supplier and can change. Checkout rechecks the plan and price; proxy credentials are shown only to the signed-in owner while the slot is active.
          </p>
        </div>
      </section>
    </main>
  );
}
