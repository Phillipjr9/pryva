import { Metadata } from "next";
import Link from "next/link";
import { serviceMap, plansFor, formatNaira } from "@/lib/catalog";
import { Check, ArrowRight } from "@/components/icons";
import { CountryFlag, CountryChips } from "@/components/CountryFlag";
import { hasCountryFlag } from "@/lib/countries";
import { ServiceIcon } from "@/components/ServiceIcon";

export const metadata: Metadata = {
  title: "eSIM",
  description: "Explore eSIM data plans. Live eSIM fulfillment is paused.",
};

export default function ESIMPage() {
  const service = serviceMap.esim;
  const plans = plansFor("esim");

  if (!service) return <div>Service not found</div>;

  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-3xl">
            <ServiceIcon service="esim" size="lg" className="mb-5" />
            <span className="inline-block rounded-full bg-lav-100 px-4 py-1.5 text-meta font-semibold text-lav-700 mb-4">{service.eyebrow}</span>
            <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem]">{service.tagline}</h1>
            <p className="mt-6 text-[1.1rem] text-ink-2 leading-relaxed">{service.description}</p>
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
            {service.highlights.map((highlight, index) => (
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
            The catalog lists plans for these regions. Live eSIM fulfillment is paused and coverage requires provider verification.
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
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8">Pricing</h2>
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
            {service.faqs.map((faq, index) => (
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
