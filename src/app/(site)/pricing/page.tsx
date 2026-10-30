import { Metadata } from "next";
import Link from "next/link";
import { plans, services, formatNaira } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";
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
            Compare catalog prices in Naira. Every price is fixed before checkout, and your wallet is only debited once delivery succeeds.
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
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                {servicePlans.map((plan) => {
                  // The fulfilment allowlist is the single source of truth for
                  // what can be sold: the plan page offers no way to pay for a
                  // plan outside it and /api/orders refuses it server-side. This
                  // page advertised a signup funnel for those plans anyway, so a
                  // visitor could be driven to create an account to buy something
                  // that could never be delivered. Plans stay listed with their
                  // price and details -- what is withdrawn is the promise to sell,
                  // using the same wording the plan page already uses.
                  const deliverable = isPlanFulfillable(plan.slug);
                  return (
                  <div
                    key={plan.slug}
                    className={`rounded-xl border p-3 sm:rounded-2xl sm:p-6 ${
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
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink sm:mb-2 sm:gap-2 sm:text-[1.1rem]">
                      {hasCountryFlag(plan.region) && <CountryFlag region={plan.region} size={20} decorative />}
                      {plan.name}
                    </h3>
                    <p className="text-[0.72rem] text-ink-2 mb-2 sm:text-[0.86rem] sm:mb-4">
                      {plan.planLabel}
                    </p>
                    <div className="mb-4">
                      <span className="text-[1.1rem] font-bold text-ink sm:text-[2rem]">
                        {formatNaira(plan.price)}
                      </span>
                      {plan.compareAt && (
                        <span className="ml-1.5 text-[0.74rem] text-ink-3 line-through sm:ml-2 sm:text-[1rem]">
                          {formatNaira(plan.compareAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-[0.72rem] text-ink-2 mb-3 sm:text-[0.86rem] sm:mb-6">
                      {plan.duration}
                    </p>
                    <ul className="space-y-1 mb-3 sm:space-y-2 sm:mb-6">
                      {/* Past two, the list is detail: on a phone it is most of
                          what makes each card taller than the product deserves. */}
                      {plan.features.map((feature, index) => (
                        <li
                          key={index}
                          className={`${index >= 2 ? "hidden sm:flex" : "flex"} items-start gap-1.5 text-[0.72rem] text-ink-2 sm:gap-2 sm:text-[0.86rem]`}
                        >
                          <Check className="h-3 w-3 text-lav-600 shrink-0 mt-0.5 sm:h-4 sm:w-4" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {deliverable ? (
                      <Link
                        href={`/signup?plan=${plan.slug}`}
                        className={`block w-full rounded-lg px-3 py-2 text-center text-[0.78rem] font-semibold transition-colors sm:rounded-xl sm:px-4 sm:py-3 sm:text-[0.9rem] ${
                          plan.popular
                            ? "bg-lav-600 text-white hover:bg-lav-700"
                            : "border border-line bg-white text-ink hover:bg-cream"
                        }`}
                      >
                        Get Started
                      </Link>
                    ) : (
                      <p className="block w-full rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-center text-[0.7rem] font-semibold leading-relaxed text-amber-900 sm:rounded-xl sm:px-4 sm:py-3 sm:text-[0.78rem]">
                        This plan cannot be delivered yet, so it cannot be ordered or charged.
                      </p>
                    )}
                  </div>
                  );
                })}
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
                Top-ups use Paystack. Paystack shows the payment methods available to you at checkout.
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
