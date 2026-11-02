import { Metadata } from "next";
import Link from "next/link";
import { serviceMap, plansFor, formatNaira } from "@/lib/catalog";
import { Check, ArrowRight } from "@/components/icons";
import { CountryFlag, CountryChips } from "@/components/CountryFlag";
import { hasCountryFlag } from "@/lib/countries";
import { ServiceIcon } from "@/components/ServiceIcon";
import { isEsimOrderingAvailable } from "@/lib/esim-availability";

/**
 * Copy for when the live catalogue is on sale. `catalog.ts` deliberately says
 * "not available yet" in its description, highlights and FAQ — that is the
 * honest answer when no network key is configured, but it contradicted the
 * hero ("issued the moment you buy") on the very same page once eSIM went live.
 * Switching the whole set, rather than one sentence, keeps both states honest.
 */
const LIVE_HIGHLIGHTS = [
  { title: "Check your device", body: "Confirm eSIM compatibility and carrier unlock requirements with your device and carrier." },
  { title: "Review coverage", body: "Coverage, data allowance and validity are read live from the network before you buy." },
  { title: "Activation code on your order", body: "A live plan is issued as an LPA activation code on the order page, with a one-tap install link." },
];

const LIVE_FAQS = [
  { q: "Does my phone support eSIM?", a: "Compatibility depends on the model, region and carrier. Check your device and carrier documentation." },
  { q: "Can I activate an eSIM now?", a: "Yes. Live plans are listed under Services → eSIM in your dashboard; the activation code appears on the order once the profile is issued." },
];

// The catalogue below is a written sample. Which of it is live depends on the
// supplier key, which Vercel snapshots at build time — reading it per request is
// the difference between "available" and a page that goes stale in one direction.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "eSIM",
  description: "Explore eSIM data plans for instant travel and local connectivity.",
};

export default function ESIMPage() {
  const service = serviceMap.esim;
  const live = isEsimOrderingAvailable();
  // With a supplier connected the sample cards are withdrawn: the real plans are
  // listed in the dashboard with live coverage and naira prices, and showing six
  // written ones next to them would read as a second, cheaper catalogue.
  const plans = live ? [] : plansFor("esim");

  if (!service) return <div>Service not found</div>;
  const highlights = live ? LIVE_HIGHLIGHTS : service.highlights;
  const faqs = live ? LIVE_FAQS : service.faqs;

  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-3xl">
            <ServiceIcon service="esim" size="lg" className="mb-5" />
            <span className="inline-block rounded-full bg-lav-100 px-4 py-1.5 text-meta font-semibold text-lav-700 mb-4">{service.eyebrow}</span>
            <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem]">{service.tagline}</h1>
            <p className="mt-6 text-[1.1rem] text-ink-2 leading-relaxed">
              {live
                ? "Live eSIM data plans, priced in naira and issued as an activation code the moment you buy."
                : service.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700">Get Started <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-6 py-3 text-[0.95rem] font-semibold text-ink hover:bg-cream">View Pricing</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((highlight, index) => (
              <div key={index} className="rounded-2xl border border-line bg-white p-6">
                <h3 className="text-[1.1rem] font-semibold text-ink mb-3">{highlight.title}</h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed">{highlight.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <h2 className="mb-3 text-[1.75rem] font-semibold text-ink">Destinations</h2>
          <p className="mb-6 max-w-2xl text-[0.95rem] text-ink-2">
            {live
              ? "Coverage is read live from the network before you buy, so check the dashboard for the destinations on sale right now. These are examples of commonly covered regions."
              : "The catalog lists plans for these regions with high-speed global and local data coverage."}
          </p>
          <CountryChips
            codes={[
              "ng", "us", "gb", "ca", "de", "fr", "nl", "ae", "za", "ke",
              "in", "br", "es", "it", "tr", "jp", "th", "sg", "my", "mx",
            ]}
          />
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8">{live ? "Live pricing" : "Pricing"}</h2>
          {live ? (
            <div className="mb-6 rounded-2xl border border-line bg-white p-6">
              <p className="text-[0.95rem] leading-relaxed text-ink-2">
                Plans are read live: coverage, data allowance, validity and the naira price for your destination. You
                are charged when the profile is issued, and it installs from an activation code on the order.
              </p>
              <Link
                href="/dashboard/esim"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-lav-600 px-5 py-2.5 text-[0.9rem] font-semibold text-white hover:bg-lav-700"
              >
                See live eSIM plans <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.slug}
                className={`rounded-2xl border p-6 flex flex-col justify-between ${
                  plan.popular
                    ? "border-lav-600 bg-white shadow-[var(--shadow-card)]"
                    : "border-line bg-white"
                }`}
              >
                <div>
                  {plan.popular && (
                    <div className="mb-4">
                      <span className="inline-block rounded-full bg-lav-100 px-3 py-1 text-meta font-semibold text-lav-700">
                        Most Popular
                      </span>
                    </div>
                  )}
                  {plan.badge && !plan.popular && (
                    <div className="mb-4">
                      <span className="inline-block rounded-full bg-lav-50 px-3 py-1 text-meta font-semibold text-lav-600">
                        {plan.badge}
                      </span>
                    </div>
                  )}
                  <h3 className="mb-2 flex items-center gap-2 text-[1.1rem] font-semibold text-ink">
                    {hasCountryFlag(plan.region) && <CountryFlag region={plan.region} size={20} decorative />}
                    {plan.name}
                  </h3>
                  <p className="text-[0.86rem] text-ink-2 mb-4">{plan.planLabel}</p>
                  <div className="mb-2">
                    <span className="text-[2rem] font-bold text-ink">{formatNaira(plan.price)}</span>
                  </div>
                  <p className="text-[0.86rem] text-ink-3 mb-5">{plan.duration}</p>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
                        <Check className="h-4 w-4 text-lav-600 shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={`/signup?plan=${plan.slug}`}
                  className={`block w-full rounded-xl px-4 py-3 text-center text-[0.9rem] font-semibold transition-colors ${
                    plan.popular
                      ? "bg-lav-600 text-white hover:bg-lav-700"
                      : "border border-line bg-white text-ink hover:bg-cream"
                  }`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="text-[0.95rem] font-semibold text-lav-600 hover:text-lav-700"
            >
              View all pricing options →
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8">FAQ</h2>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div key={index} className="rounded-2xl border border-line bg-white p-6">
                <h3 className="text-[1rem] font-semibold text-ink mb-3">{faq.q}</h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
