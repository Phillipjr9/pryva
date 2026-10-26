import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { serviceMap, plansFor, formatNaira } from "@/lib/catalog";
import { Check, ArrowRight } from "@/components/icons";

export const metadata: Metadata = {
  title: "Virtual Numbers",
  description: "Buy virtual numbers from 40+ countries for SMS verification. Non-VoIP, instant delivery, auto-refund.",
};

export default function VirtualNumbersPage() {
  const service = serviceMap.numbers;
  const plans = plansFor("numbers");

  if (!service) {
    return <div>Service not found</div>;
  }

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
      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-3xl">
            <span className="inline-block rounded-full bg-lav-100 px-4 py-1.5 text-[0.78rem] font-semibold text-lav-700 mb-4 dark:bg-lav-900/30 dark:text-lav-300">
              {service.eyebrow}
            </span>
            <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem] dark:text-gray-100">
              {service.tagline}
            </h1>
            <p className="mt-6 text-[1.1rem] text-ink-2 leading-relaxed dark:text-gray-400">
              {service.description}
            </p>
            <div className="mt-8 flex gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-6 py-3 text-[0.95rem] font-semibold text-ink hover:bg-cream dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {service.highlights.map((highlight, index) => (
              <div
                key={index}
                className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700"
              >
                <h3 className="text-[1.1rem] font-semibold text-ink mb-3 dark:text-gray-100">
                  {highlight.title}
                </h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed dark:text-gray-400">
                  {highlight.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Included */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8 dark:text-gray-100">
            What's included
          </h2>
          <div className="space-y-4">
            {service.included.map((item, index) => (
              <div key={index} className="flex items-start gap-3">
                <Check className="h-5 w-5 text-lav-600 dark:text-lav-400 shrink-0 mt-0.5" />
                <p className="text-[0.95rem] text-ink-2 dark:text-gray-400">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="pb-16">
        <div className="shell">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8 dark:text-gray-100">
            Pricing
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.slice(0, 6).map((plan) => (
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
                <p className="text-[0.86rem] text-ink-2 mb-4 dark:text-gray-400">{plan.planLabel}</p>
                <div className="mb-4">
                  <span className="text-[2rem] font-bold text-ink dark:text-gray-100">
                    {formatNaira(plan.price)}
                  </span>
                </div>
                <p className="text-[0.86rem] text-ink-2 mb-6 dark:text-gray-400">{plan.duration}</p>
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
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="text-[0.95rem] font-semibold text-lav-600 hover:text-lav-700 dark:text-lav-400 dark:hover:text-lav-300"
            >
              View all pricing options →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8 dark:text-gray-100">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {service.faqs.map((faq, index) => (
              <div
                key={index}
                className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700"
              >
                <h3 className="text-[1rem] font-semibold text-ink mb-3 dark:text-gray-100">{faq.q}</h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed dark:text-gray-400">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
