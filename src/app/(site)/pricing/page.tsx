import { Metadata } from "next";
import Link from "next/link";
import { plans, services, formatNaira } from "@/lib/catalog";
import { Check } from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { CountryFlag } from "@/components/CountryFlag";
import { hasCountryFlag } from "@/lib/countries";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Explore catalog prices in Naira and review current service availability.",
};

export default function PricingPage() {
  const serviceGroups = [
    { slug: "numbers", name: "Virtual Numbers" },
    { slug: "esim", name: "eSIM" },
    { slug: "proxies", name: "Residential Proxies" },
    { slug: "email-otp", name: "Email OTP" },
  ];

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero */}
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 max-w-2xl mx-auto">
            Compare catalog prices in Naira. Live number, eSIM, proxy and inbox fulfillment is paused; preview orders are simulated.
          </p>
        </div>
      </section>

      {/* Pricing by Service */}
      {serviceGroups.map((group) => {
        const servicePlans = plans.filter((p) => p.service === group.slug);
        if (servicePlans.length === 0) return null;

        return (
          <section key={group.slug} className="pb-16">
            <div className="shell">
              <div className="flex items-center gap-4 mb-8">
                <ServiceIcon service={group.slug as any} size="lg" />
                <h2 className="text-[1.75rem] font-semibold text-ink">
                  {group.name}
                </h2>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {servicePlans.map((plan) => (
                  <div
                    key={plan.slug}
                    className={`rounded-2xl border p-6 ${
                      plan.popular
                        ? "border-lav-600 bg-white shadow-[var(--shadow-card)]"
                        : "border-line bg-white"
                    }`}
                  >
                    {plan.popular && (
                      <div className="mb-4">
                        <span className="inline-block rounded-full bg-lav-100 px-3 py-1 text-[0.72rem] font-semibold text-lav-700">
                          Most Popular
                        </span>
                      </div>
                    )}
                    <h3 className="mb-2 flex items-center gap-2 text-[1.1rem] font-semibold text-ink">
                      {hasCountryFlag(plan.region) && <CountryFlag region={plan.region} size={20} decorative />}
                      {plan.name}
                    </h3>
                    <p className="text-[0.86rem] text-ink-2 mb-4">
                      {plan.planLabel}
                    </p>
                    <div className="mb-4">
                      <span className="text-[2rem] font-bold text-ink">
                        {formatNaira(plan.price)}
                      </span>
                      {plan.compareAt && (
                        <span className="ml-2 text-[1rem] text-ink-3 line-through">
                          {formatNaira(plan.compareAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-[0.86rem] text-ink-2 mb-6">
                      {plan.duration}
                    </p>
                    <ul className="space-y-2 mb-6">
                      {plan.features.map((feature, index) => (
                        <li key={index} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
                          <Check className="h-4 w-4 text-lav-600 shrink-0 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
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
            </div>
          </section>
        );
      })}

      {/* FAQ */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-white p-6">
              <h3 className="text-[1rem] font-semibold text-ink mb-2">
                Are there any hidden fees?
              </h3>
              <p className="text-[0.9rem] text-ink-2">
                Review the final amount and any provider fees before confirming a payment.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6">
              <h3 className="text-[1rem] font-semibold text-ink mb-2">
                What payment methods do you accept?
              </h3>
              <p className="text-[0.9rem] text-ink-2">
                In a configured live environment, top-ups use Paystack. Available payment methods depend on the provider; top-ups are disabled in preview.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6">
              <h3 className="text-[1rem] font-semibold text-ink mb-2">
                Can I get a refund?
              </h3>
              <p className="text-[0.9rem] text-ink-2">
                Contact support with your order reference. Refunds require review of the delivery and provider status.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
