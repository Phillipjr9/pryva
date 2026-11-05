import { Metadata } from "next";
import Link from "next/link";
import { serviceMap } from "@/lib/catalog";
import { ArrowRight } from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { isEsimOrderingAvailable } from "@/lib/esim-availability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "eSIM",
  description: "Explore eSIM data plans and check current travel and local coverage.",
};

export default function ESIMPage() {
  const service = serviceMap.esim;
  const live = isEsimOrderingAvailable();
  const faqs = live
    ? service.faqs.map((faq) =>
        faq.q === "Can I activate an eSIM now?"
          ? { q: faq.q, a: "If a plan is available for your destination, you can order it from your wallet. Check the order for its status and activation code once issued." }
          : faq,
      )
    : service.faqs;
  const highlights = live
    ? [
        { title: "Check your device", body: "Confirm eSIM compatibility and carrier unlock requirements with your device and carrier." },
        { title: "Buy and install", body: "Pick a plan for your destination, pay from your wallet, and install from the activation code on the order." },
        { title: "Check current plans", body: "Browse current plans, data allowances and naira prices. Availability can change by destination." },
      ]
    : service.highlights;

  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-3xl">
            <ServiceIcon service="esim" size="lg" className="mb-5" />
            <span className="mb-4 inline-block rounded-full bg-lav-100 px-4 py-1.5 text-meta font-semibold text-lav-700">{service.eyebrow}</span>
            <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem]">{service.tagline}</h1>
            <p className="mt-6 text-[1.1rem] leading-relaxed text-ink-2">
              {live
                ? "eSIM ordering is connected. Browse current plans, prices and availability in your dashboard."
                : "eSIM ordering is not connected yet. Current plans and prices will appear when ordering is available."}
            </p>
            <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
              <Link href={live ? "/dashboard/esim" : "/signup"} className="inline-flex items-center gap-2 rounded-xl bg-lav-700 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-800">{live ? "Browse eSIM plans" : "Create an account"} <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-6 py-3 text-[0.95rem] font-semibold text-ink hover:bg-cream">View pricing</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((highlight) => (
            <div key={highlight.title} className="rounded-2xl border border-line bg-white p-6">
              <h2 className="mb-3 text-[1.1rem] font-semibold text-ink">{highlight.title}</h2>
              <p className="text-[0.9rem] leading-relaxed text-ink-2">{highlight.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <h2 className="mb-6 text-[1.75rem] font-semibold text-ink">Current plans and destinations</h2>
          <div className="rounded-2xl border border-line bg-white p-6">
            <p className="text-[0.95rem] leading-relaxed text-ink-2">
              {live
                ? "Browse current plans for your destination, including their data allowance, validity and price. Availability can change."
                : "Ordering is currently unavailable. Coverage, plans and prices cannot be confirmed on this deployment."}
            </p>
            {live && <Link href="/dashboard/esim" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-lav-700 px-5 py-2.5 text-[0.9rem] font-semibold text-white hover:bg-lav-800">See current eSIM plans <ArrowRight className="h-4 w-4" /></Link>}
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="mb-8 text-[1.75rem] font-semibold text-ink">FAQ</h2>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <div key={faq.q} className="rounded-2xl border border-line bg-white p-6">
                <h3 className="mb-3 text-[1rem] font-semibold text-ink">{faq.q}</h3>
                <p className="text-[0.9rem] leading-relaxed text-ink-2">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
