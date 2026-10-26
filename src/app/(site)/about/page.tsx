import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { Monogram } from "@/components/brand/Logo";
import {
  ArrowRight,
  Card,
  Check,
  Globe,
  Heart,
  Lock,
  Shield,
  Sparkle,
  Users,
  Wallet,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "About Pryva",
  description:
    "Pryva is built in Lagos for Nigerians who need reliable virtual numbers, eSIM data, residential proxies and email OTP — with Naira pricing and automatic refunds.",
};

const values = [
  {
    icon: Shield,
    title: "Reliability over hype",
    body: "A number that works on the first attempt is worth more than ten features. We measure ourselves on delivery, not on landing pages.",
  },
  {
    icon: Wallet,
    title: "Priced for Nigeria",
    body: "Naira first. Bank transfer and local cards. No dollar-card gymnastics, no hidden conversion at checkout.",
  },
  {
    icon: Lock,
    title: "Privacy is the product",
    body: "Verification should not cost you your primary inbox or real number. We keep your services isolated and your data minimal.",
  },
  {
    icon: Heart,
    title: "Calm, human support",
    body: "Real people in Lagos reply to messages. Clear sentences, no scripts, no escalating you through five bots.",
  },
];

const stats = [
  { value: "4,200+", label: "services delivered" },
  { value: "40+", label: "number countries" },
  { value: "190+", label: "eSIM destinations" },
  { value: "98.4%", label: "codes received in-window" },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative grain overflow-hidden pb-12 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute left-[-10rem] top-[-10rem] h-[28rem] w-[28rem] rounded-full bg-lav-200/45 blur-[120px]" />
        <div className="shell relative">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <Reveal>
                <span className="eyebrow">About Pryva</span>
              </Reveal>
              <Reveal delay={60}>
                <h1 className="mt-4 text-[2.5rem] font-medium leading-[1.03] tracking-[-0.035em] sm:text-[3.3rem]">
                  Calm infrastructure
                  <br />
                  <span className="text-display italic text-lav-700">for a noisy internet.</span>
                </h1>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-5 max-w-xl text-[0.98rem] leading-relaxed text-ink-2">
                  Pryva started with a small, familiar frustration: needing a verification code for a
                  platform that didn&apos;t accept Nigerian numbers, and having no clean way to pay.
                  The options were sketchy resellers, dollar cards and screenshots you lose by
                  morning. So we built the version we wanted — clear prices in Naira, real numbers
                  from a reputable provider, and a dashboard that remembers everything.
                </p>
              </Reveal>
              <Reveal delay={170}>
                <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-ink-2">
                  Today Pryva serves founders, marketers, QA teams and travellers across Nigeria. We
                  are intentionally narrow: virtual numbers, eSIM data, residential proxies and
                  temporary inboxes. Do those four things reliably and the rest is noise.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
                  <Link href="/signup" className="btn btn-primary">
                    Create an account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/how-it-works" className="btn btn-ghost">
                    How it works
                  </Link>
                </div>
              </Reveal>
            </div>

            <Reveal delay={140}>
              <div className="relative">
                <div className="rounded-[2rem] border border-white bg-white/80 p-6 shadow-[var(--shadow-card)] backdrop-blur">
                  <Monogram className="h-14 w-14" />
                  <p className="mt-5 text-display text-[1.9rem] leading-[1.15] text-ink">
                    “Secure solutions. Simple experience.”
                  </p>
                  <p className="mt-3 text-[0.84rem] leading-relaxed text-ink-2">
                    That internal line became our product test. If a decision adds friction without
                    adding security, it doesn&apos;t ship.
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-2.5">
                    {stats.map((stat) => (
                      <div key={stat.label} className="rounded-xl bg-lav-50/80 px-3.5 py-3">
                        <p className="text-[1.15rem] font-semibold text-lav-800">{stat.value}</p>
                        <p className="text-[0.68rem] text-ink-3">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="absolute -bottom-4 left-6 inline-flex items-center gap-2 rounded-full border border-white bg-white px-4 py-2 shadow-[var(--shadow-soft)]">
                  <Shield className="h-4 w-4 text-lav-600" />
                  <span className="text-[0.72rem] font-semibold text-ink">
                    Simple. Secure. Scalable.
                  </span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="py-14">
        <div className="shell">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <Reveal>
                <span className="eyebrow">What we believe</span>
              </Reveal>
              <Reveal delay={60}>
                <h2 className="mt-3 text-[2rem] font-medium leading-[1.08] sm:text-[2.5rem]">
                  Four rules we
                  <br />
                  <span className="text-display italic text-lav-700">keep coming back to.</span>
                </h2>
              </Reveal>
              <Reveal delay={110}>
                <p className="mt-4 max-w-sm text-[0.9rem] leading-relaxed text-ink-2">
                  They sound obvious. Most platforms quietly break at least two of them, which is why
                  people arrive at Pryva tired.
                </p>
              </Reveal>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {values.map((value, index) => {
                const Icon = value.icon;
                return (
                  <Reveal key={value.title} delay={index * 60}>
                    <div className="h-full rounded-2xl border border-line bg-[#fffdfa] p-5">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-lav-50 text-lav-700">
                        <Icon className="h-4 w-4" />
                      </span>
                      <h3 className="mt-3.5 text-[0.95rem] font-semibold">{value.title}</h3>
                      <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-2">{value.body}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="pb-12">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-lav-200/70 bg-gradient-to-br from-lav-100/80 via-cream to-cream-2 p-6 sm:p-10">
              <Monogram className="pointer-events-none absolute -right-8 -top-12 h-60 w-60 opacity-[0.07]" />
              <div className="relative grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
                <div>
                  <span className="eyebrow">Our infrastructure partner</span>
                  <h2 className="mt-3 text-[1.8rem] font-medium leading-[1.1]">
                    We don&apos;t pretend to own
                    <br />
                    <span className="text-display italic text-lav-700">the whole network.</span>
                  </h2>
                  <p className="mt-3 max-w-md text-[0.9rem] leading-relaxed text-ink-2">
                    Numbers, eSIMs, residential proxy bandwidth and email OTP provisioning are
                    delivered through <span className="font-semibold text-ink">Fleexa</span>, a
                    specialised telecom and proxy provider. Pryva owns the experience: Naira
                    pricing, the dashboard, refunds and support.
                  </p>
                  <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                    {[
                      "Carrier-grade, non-VoIP lines",
                      "Regional eSIM data coverage",
                      "Ethically sourced residential IPs",
                      "Dedicated OTP mail domains",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[0.82rem] text-ink-2">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-2.5">
                  {[
                    { icon: Globe, label: "Coverage", value: "40+ countries for numbers" },
                    { icon: Card, label: "Payments", value: "Bank transfer & local cards" },
                    { icon: Users, label: "Support", value: "Lagos team, real replies" },
                    { icon: Sparkle, label: "Refunds", value: "Automatic on undelivered codes" },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white bg-white/85 px-4 py-3"
                      >
                        <span className="inline-flex items-center gap-2 text-[0.74rem] font-medium text-ink-2">
                          <Icon className="h-3.5 w-3.5 text-lav-600" />
                          {item.label}
                        </span>
                        <span className="text-right text-[0.76rem] font-semibold text-ink">
                          {item.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
