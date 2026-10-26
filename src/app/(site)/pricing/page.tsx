import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { plans, services, formatNaira } from "@/lib/catalog";
import { Check } from "@/components/icons";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Transparent pricing for all Pryva services. Pay in Naira, no hidden fees.",
};

export default function PricingPage() {
  const serviceGroups = [
    { slug: "numbers", name: "Virtual Numbers" },
    { slug: "esim", name: "eSIM" },
    { slug: "proxies", name: "Residential Proxies" },
    { slug: "email-otp", name: "Email OTP" },
  ];

  return (
    <div className="min-h-screen bg-cream dark:bg-gray-900">
      {/* Header */}
      <header className="border-b border-line bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-[0.86rem] font-medium text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-lav-600 px-4 py-2 text-[0.86rem] font-semibold text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem] dark:text-gray-100">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 dark:text-gray-400 max-w-2xl mx-auto">
            Pay in Naira, no hidden fees, instant delivery. Choose the service that fits your needs.
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
              <h2 className="text-[1.75rem] font-semibold text-ink mb-8 dark:text-gray-100">
                {group.name}
              </h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {servicePlans.map((plan) => (
                  <div
                    key={plan.slug}
                    className={`rounded-2xl border p-6 ${
                      plan.popular
                        ? "border-lav-600 bg-white shadow-[var(--shadow-card)] dark:bg-gray-800 dark:border-lav-500"
                        : "border-line bg-white dark:bg-gray-800 dark:border-gray-700"
                    }`}
                  >
                    {plan.popular && (
                      <div className="mb-4">
                        <span className="inline-block rounded-full bg-lav-100 px-3 py-1 text-[0.72rem] font-semibold text-lav-700 dark:bg-lav-900/30 dark:text-lav-300">
                          Most Popular
                        </span>
                      </div>
                    )}
                    <h3 className="text-[1.1rem] font-semibold text-ink mb-2 dark:text-gray-100">
                      {plan.name}
                    </h3>
                    <p className="text-[0.86rem] text-ink-2 mb-4 dark:text-gray-400">
                      {plan.planLabel}
                    </p>
                    <div className="mb-4">
                      <span className="text-[2rem] font-bold text-ink dark:text-gray-100">
                        {formatNaira(plan.price)}
                      </span>
                      {plan.compareAt && (
                        <span className="ml-2 text-[1rem] text-ink-3 line-through dark:text-gray-500">
                          {formatNaira(plan.compareAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-[0.86rem] text-ink-2 mb-6 dark:text-gray-400">
                      {plan.duration}
                    </p>
                    <ul className="space-y-2 mb-6">
                      {plan.features.map((feature, index) => (
                        <li key={index} className="flex items-start gap-2 text-[0.86rem] text-ink-2 dark:text-gray-400">
                          <Check className="h-4 w-4 text-lav-600 dark:text-lav-400 shrink-0 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={`/signup?plan=${plan.slug}`}
                      className={`block w-full rounded-xl px-4 py-3 text-center text-[0.9rem] font-semibold transition-colors ${
                        plan.popular
                          ? "bg-lav-600 text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600"
                          : "border border-line bg-white text-ink hover:bg-cream dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-600"
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
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8 text-center dark:text-gray-100">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700">
              <h3 className="text-[1rem] font-semibold text-ink mb-2 dark:text-gray-100">
                Are there any hidden fees?
              </h3>
              <p className="text-[0.9rem] text-ink-2 dark:text-gray-400">
                No. The price you see is the price you pay. No setup fees, no monthly fees, no hidden charges.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700">
              <h3 className="text-[1rem] font-semibold text-ink mb-2 dark:text-gray-100">
                What payment methods do you accept?
              </h3>
              <p className="text-[0.9rem] text-ink-2 dark:text-gray-400">
                We accept bank transfers, debit cards, and other popular Nigerian payment methods through Paystack.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700">
              <h3 className="text-[1rem] font-semibold text-ink mb-2 dark:text-gray-100">
                Can I get a refund?
              </h3>
              <p className="text-[0.9rem] text-ink-2 dark:text-gray-400">
                Yes! If your service doesn't work as expected, you'll receive an automatic refund to your wallet.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
