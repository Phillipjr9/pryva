import { Metadata } from "next";
import Link from "next/link";
import { plans, services, formatNaira } from "@/lib/services/catalog";
import { isNumberPlanOrderingConfigured } from "@/lib/services/numbers/number-availability";
import { Check } from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { CountryFlag } from "@/components/CountryFlag";
import { hasCountryFlag } from "@/lib/platform/countries";
import { isEsimOrderingAvailable } from "@/lib/services/esim/esim-availability";

export const metadata: Metadata = {
  title: "Pricing & Plans",
  description:
    "Compare PryvaLogs pricing for virtual numbers, eSIM, proxies and email OTP in Naira. See current availability and transparent plan costs.",
  keywords: [
    "PryvaLogs pricing",
    "virtual number prices Nigeria",
    "eSIM price Nigeria",
    "proxy pricing",
    "email OTP pricing",
  ],
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "PryvaLogs pricing and plans",
    description: "Compare Naira pricing for virtual numbers, eSIM data, proxies and email OTP services.",
    url: "/pricing",
  },
};

export const dynamic = "force-dynamic";

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
      <section className="py-8 sm:py-16">
        <div className="shell text-center">
          <h1 className="text-[1.7rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-[0.875rem] text-ink-2 sm:mt-4 sm:text-[1.125rem]">
            Compare catalog prices in Naira. Availability varies, so review the final amount and terms before confirming an order.
          </p>
        </div>
      </section>

      <section className="pb-6 sm:pb-10">
        <div className="shell">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {serviceGroups.map((group) => {
              const count = plans.filter((plan) => plan.service === group.slug).length;
              return (
                <div key={group.slug} className="rounded-xl border border-line bg-white/85 p-2.5 text-left shadow-[var(--shadow-card)] sm:rounded-2xl sm:p-3">
                  <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-ink-3 sm:text-[0.8125rem]">{group.name}</p>
                  <p className="mt-1.5 text-[0.9375rem] font-semibold text-ink sm:mt-2 sm:text-[1.125rem]">{count}</p>
                  <p className="text-[0.8125rem] text-ink-2 sm:text-[0.8125rem]">plans</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing by Service */}
      {serviceGroups.map((group) => {
        if (group.slug === "esim") {
          const live = isEsimOrderingAvailable();
          return (
            <section key={group.slug} className="pb-16">
              <div className="shell">
                <div className="mb-6 flex items-center gap-3 sm:mb-8 sm:gap-4"><ServiceIcon service="esim" size="lg" /><h2 className="text-[1.35rem] font-semibold text-ink sm:text-[1.75rem]">eSIM</h2></div>
                <div className="rounded-2xl border border-line bg-white p-6">
                  <p className="text-ink-2">{live ? "Current eSIM plans, prices and coverage are listed in the dashboard." : "eSIM ordering is currently unavailable; prices and coverage cannot be confirmed."}</p>
                  {live && <Link href="/dashboard/services?category=esim" className="mt-4 inline-flex font-semibold text-lav-700 underline underline-offset-2">Browse current eSIM plans</Link>}
                </div>
              </div>
            </section>
          );
        }
        const servicePlans = plans.filter((p) => p.service === group.slug);
        if (servicePlans.length === 0) return null;

        return (
          <section key={group.slug} className="pb-10 sm:pb-16">
            <div className="shell">
              <div className="mb-4 flex items-center gap-3 sm:mb-8 sm:gap-4">
                <ServiceIcon service={group.slug as any} size="lg" />
                <h2 className="text-[1.25rem] font-semibold text-ink sm:text-[1.75rem]">
                  {group.name}
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                {servicePlans.map((plan) => {
                  // A static mapping is not a configured checkout, and a
                  // configured checkout is not proof of stock or fulfilment.
                  const deliverable = plan.service === "numbers" && isNumberPlanOrderingConfigured(plan.slug);
                  return (
                  <div
                    key={plan.slug}
                    className={`rounded-xl border p-3 sm:rounded-2xl sm:p-5 ${
                      plan.popular
                        ? "border-lav-600 bg-white shadow-[var(--shadow-card)]"
                        : "border-line bg-white"
                    }`}
                  >
                    {plan.popular && (
                      <div className="mb-3 sm:mb-4">
                        <span className="inline-block rounded-full bg-lav-100 px-2.5 py-1 text-[0.8125rem] font-semibold text-lav-700 sm:text-meta">
                          Most Popular
                        </span>
                      </div>
                    )}
                    <div className="mb-1.5 flex items-start justify-between gap-2 sm:mb-3">
                      <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink sm:gap-2 sm:text-[1rem]">
                        {hasCountryFlag(plan.region) && <CountryFlag region={plan.region} size={15} decorative />}
                        {plan.name}
                      </h3>
                      <span className="rounded-full bg-cream px-2 py-1 text-[0.8125rem] font-semibold text-ink-3 sm:text-[0.8125rem]">
                        {plan.duration}
                      </span>
                    </div>
                    <p className="mb-2 text-[0.8125rem] text-ink-2 sm:mb-4 sm:text-[0.875rem]">
                      {plan.planLabel}
                    </p>
                    <div className="mb-2 sm:mb-4">
                      <span className="text-[0.9375rem] font-bold leading-none text-ink sm:text-[1.9rem]">
                        {formatNaira(plan.price)}
                      </span>
                      {plan.compareAt && (
                        <span className="ml-1.5 text-[0.8125rem] text-ink-3 line-through sm:ml-2 sm:text-[0.875rem]">
                          {formatNaira(plan.compareAt)}
                        </span>
                      )}
                    </div>
                    <ul className="mb-3 space-y-1.5 sm:mb-5 sm:space-y-2">
                      {/* Keep the list compact enough to feel portable on a phone. */}
                      {plan.features.map((feature, index) => (
                        <li
                          key={index}
                          className={`${index >= 1 ? "hidden sm:flex" : "flex"} items-start gap-1.5 text-[0.8125rem] leading-relaxed text-ink-2 sm:gap-2 sm:text-[0.875rem]`}
                        >
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-lav-600 sm:h-4 sm:w-4" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {deliverable ? (
                      <Link
                        href={`/signup?plan=${plan.slug}`}
                        className={`block w-full rounded-lg px-3 py-2 text-center text-[0.8125rem] font-semibold transition-colors sm:rounded-xl sm:px-4 sm:py-3 sm:text-[0.875rem] ${
                          plan.popular
                            ? "bg-lav-700 text-white hover:bg-lav-800"
                            : "border border-line bg-white text-ink hover:bg-cream"
                        }`}
                      >
                        Get Started
                      </Link>
                    ) : (
                      <p className="block w-full rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-center text-[0.8125rem] font-semibold leading-relaxed text-amber-900 sm:rounded-xl sm:px-4 sm:py-3 sm:text-[0.8125rem]">
                        Ordering is unavailable for this plan here; no charge can be made.
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
              <p className="text-[0.875rem] text-ink-2">
                Review the final amount and any provider fees before confirming a payment.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6">
              <h3 className="text-[1rem] font-semibold text-ink mb-2">
                What payment methods do you accept?
              </h3>
              <p className="text-[0.875rem] text-ink-2">
                Top-ups use Paystack. Paystack shows the payment methods available to you at checkout.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6">
              <h3 className="text-[1rem] font-semibold text-ink mb-2">
                Can I get a refund?
              </h3>
              <p className="text-[0.875rem] text-ink-2">
                Contact support with your order reference. Refunds require review of the delivery and provider status.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
