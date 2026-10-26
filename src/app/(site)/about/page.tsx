import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Shield, Zap, Heart, Globe } from "@/components/icons";

export const metadata: Metadata = {
  title: "About Pryva",
  description: "Learn about Pryva's mission to simplify digital services for Nigerians.",
};

const values = [
  {
    icon: Shield,
    title: "Trust & Security",
    description: "We prioritize your privacy and security with industry-standard encryption and transparent practices.",
  },
  {
    icon: Zap,
    title: "Instant Delivery",
    description: "Get your virtual numbers, eSIMs, and other services delivered in seconds, not hours.",
  },
  {
    icon: Heart,
    title: "Customer First",
    description: "Built for Nigerians, by Nigerians. We understand your needs and build solutions that work.",
  },
  {
    icon: Globe,
    title: "Global Access",
    description: "Access services from 40+ countries and 190+ destinations, all from one platform.",
  },
];

const stats = [
  { label: "Happy Customers", value: "10,000+" },
  { label: "Services Delivered", value: "50,000+" },
  { label: "Countries Supported", value: "40+" },
  { label: "Uptime", value: "99.9%" },
];

export default function AboutPage() {
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
      <section className="py-16 sm:py-24">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem] dark:text-gray-100">
            Simplifying digital services
            <br />
            <span className="text-lav-600 dark:text-lav-400">for Nigerians</span>
          </h1>
          <p className="mt-6 text-[1.1rem] text-ink-2 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Pryva was built to solve a simple problem: accessing virtual numbers, eSIMs, and other digital services shouldn't be complicated or expensive. We're making it easy for Nigerians to connect globally.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-line bg-white p-6 text-center dark:bg-gray-800 dark:border-gray-700"
              >
                <p className="text-[2.5rem] font-bold text-lav-600 dark:text-lav-400">{stat.value}</p>
                <p className="text-[0.9rem] text-ink-2 dark:text-gray-400 mt-2">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[2rem] font-medium tracking-tight text-ink mb-6 dark:text-gray-100">
            Our Story
          </h2>
          <div className="space-y-4 text-[1rem] text-ink-2 leading-relaxed dark:text-gray-400">
            <p>
              Pryva started with a simple observation: Nigerians face unnecessary friction when trying to access global digital services. Whether it's verifying accounts on international platforms, staying connected while traveling, or accessing services that require non-Nigerian phone numbers, the process was often complicated, expensive, or simply unavailable.
            </p>
            <p>
              We built Pryva to change that. Our platform brings together virtual numbers from 40+ countries, eSIM data for 190+ destinations, residential proxies, and more—all accessible with Naira payments and instant delivery.
            </p>
            <p>
              Today, thousands of Nigerians use Pryva every day for everything from WhatsApp verification to international travel. We're proud to be part of their journey and committed to making digital services more accessible, affordable, and reliable.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="pb-16">
        <div className="shell">
          <h2 className="text-[2rem] font-medium tracking-tight text-ink mb-8 text-center dark:text-gray-100">
            Our Values
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((value) => {
              const Icon = value.icon;
              return (
                <div
                  key={value.title}
                  className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600 mb-4 dark:bg-lav-900/30 dark:text-lav-400">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-[1.1rem] font-semibold text-ink mb-2 dark:text-gray-100">
                    {value.title}
                  </h3>
                  <p className="text-[0.86rem] text-ink-2 leading-relaxed dark:text-gray-400">
                    {value.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-16">
        <div className="shell">
          <div className="rounded-2xl border border-line bg-white p-8 text-center dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-[1.75rem] font-semibold text-ink mb-3 dark:text-gray-100">
              Ready to get started?
            </h2>
            <p className="text-[0.95rem] text-ink-2 mb-6 max-w-md mx-auto dark:text-gray-400">
              Join thousands of Nigerians using Pryva for their digital service needs.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600"
            >
              Create Your Account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
