import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { Monogram } from "@/components/brand/Logo";
import {
  ArrowRight,
  Bolt,
  Card,
  Check,
  Clock,
  Globe,
  Mail,
  Phone,
  Refresh,
  Shield,
  Sim,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { formatNaira, plansFor } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "From creating an account to receiving your code: how Pryva delivers virtual numbers, eSIMs, proxy bandwidth and temporary inboxes in Naira, with automatic refunds.",
};

const detailedSteps = [
  {
    n: "01",
    title: "Create your Pryva account",
    body: "Name, email, password. That's the whole signup. You'll land in a dashboard that shows your wallet, orders and any codes you've received.",
    detail: "No BVN, no passport upload, no waiting list.",
    icon: Wallet,
  },
  {
    n: "02",
    title: "Fund your wallet in Naira",
    body: "Top up with a Nigerian bank transfer or a local card. The balance is available the moment the payment confirms, and unused funds stay yours for 90 days.",
    detail: "Top-ups from ₦2,000. Balance visible in the header on every page.",
    icon: Card,
  },
  {
    n: "03",
    title: "Pick a service and a plan",
    body: "One-time number, 30-day rental, eSIM bundle, proxy bandwidth or a temporary inbox. Prices are final and shown before you pay.",
    detail: "Checkout takes one tap — no external gateway redirect.",
    icon: Sparkle,
  },
  {
    n: "04",
    title: "Receive it instantly",
    body: "The number, activation QR code, endpoint credentials or inbox address appears in your dashboard immediately, and stays there for later.",
    detail: "Codes update live as they arrive, with the delivery window visible.",
    icon: Bolt,
  },
  {
    n: "05",
    title: "Refund if the code doesn't arrive",
    body: "If a verification code never lands inside the delivery window, tap Request auto-refund. The full amount returns to your wallet — no support ticket, no back-and-forth.",
    detail: "Refunds are logged in your wallet history with a reference.",
    icon: Refresh,
  },
];

const protections = [
  {
    icon: Shield,
    title: "Non-VoIP numbers",
    body: "Every line is carrier-grade, sourced through Fleexa. That's why major platforms accept it.",
  },
  {
    icon: Clock,
    title: "Visible delivery windows",
    body: "Each number order shows its live window, so you always know when a refund becomes available.",
  },
  {
    icon: Globe,
    title: "Proof of provisioning",
    body: "Delivery details come straight from the provider API, not a queue managed by hand.",
  },
  {
    icon: Refresh,
    title: "Refunds without friction",
    body: "Undelivered numbers refund automatically to your wallet, with a reference you can quote.",
  },
];

const faqs = [
  {
    q: "How long does delivery actually take?",
    a: "Usually seconds. Number orders display a line immediately after payment; eSIMs show a QR code and activation notes at once; proxy credentials and temporary inboxes are issued instantly. If a provider pool is briefly empty, we tell you on the order instead of leaving you guessing.",
  },
  {
    q: "Can I see my past codes and credentials?",
    a: "Yes. Every order stays in your dashboard with its codes, activation details or endpoint credentials, so you can copy them from any device later.",
  },
  {
    q: "Do I need to keep my laptop open?",
    a: "No. Your orders live on our servers. You can close the tab, and come back to the order page to copy the number, code or QR details whenever you need them.",
  },
  {
    q: "What payment methods work?",
    a: "Nigerian bank transfers and local debit cards. Everything is priced in Naira, and your wallet balance is what pays for orders — no international card required.",
  },
];

export default function HowItWorksPage() {
  const numbers = plansFor("numbers");

  return (
    <>
      <section className="relative grain overflow-hidden pb-12 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute left-1/2 top-[-8rem] h-[24rem] w-[36rem] -translate-x-1/2 rounded-full bg-lav-200/40 blur-[120px]" />
        <div className="shell relative">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <span className="eyebrow justify-center">How it works</span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="mt-4 text-[2.5rem] font-medium leading-[1.03] tracking-[-0.035em] sm:text-[3.3rem]">
                Quietly simple,
                <br />
                <span className="text-display italic text-lav-700">from top-up to code.</span>
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mx-auto mt-5 max-w-xl text-[1rem] leading-relaxed text-ink-2">
                Pryva hides the plumbing behind a few clear screens. Here is exactly what happens
                between signing up and copying your verification code.
              </p>
            </Reveal>
            <Reveal delay={170}>
              <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row">
                <Link href="/signup" className="btn btn-primary">
                  Create free account
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/pricing" className="btn btn-ghost">
                  See prices first
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="pb-10">
        <div className="shell">
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
            <div className="grid gap-3">
              {detailedSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <Reveal key={step.n} delay={index * 60}>
                    <div className="flex gap-4 rounded-2xl border border-line bg-white/60 p-5 sm:gap-6 sm:p-6">
                      <div className="flex flex-col items-center">
                        <span className="text-display text-[1.6rem] leading-none text-lav-400">
                          {step.n}
                        </span>
                        <span className="mt-2 hidden w-px flex-1 bg-line sm:block" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-lav-700">
                            <Icon className="h-4 w-4" />
                          </span>
                          <h2 className="text-[1.05rem] font-semibold">{step.title}</h2>
                        </div>
                        <p className="mt-2.5 text-[0.87rem] leading-relaxed text-ink-2">
                          {step.body}
                        </p>
                        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-cream-2/70 px-3 py-1 text-[0.72rem] text-ink-2">
                          <Check className="h-3 w-3 text-lav-600" />
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>

            <div className="grid gap-3 lg:sticky lg:top-24">
              <Reveal delay={80}>
                <div className="rounded-2xl border border-lav-200 bg-gradient-to-br from-lav-100/80 via-[#fbf7ff] to-white p-5">
                  <Monogram className="h-9 w-9" />
                  <h2 className="mt-4 text-[1.1rem] font-semibold">What it costs to try</h2>
                  <p className="mt-1.5 text-[0.83rem] leading-relaxed text-ink-2">
                    The cheapest way to test Pryva is a temporary inbox at{" "}
                    {formatNaira(700)} or a Nigerian verification at{" "}
                    {formatNaira(numbers[0]?.price ?? 1200)}.
                  </p>
                  <ul className="mt-4 space-y-2 text-[0.82rem] text-ink-2">
                    <li className="flex items-center justify-between border-b border-line/80 pb-2">
                      <span className="inline-flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-lav-600" /> Temp inbox · 24h
                      </span>
                      <span className="font-semibold">{formatNaira(700)}</span>
                    </li>
                    <li className="flex items-center justify-between border-b border-line/80 pb-2">
                      <span className="inline-flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-lav-600" /> NG verification
                      </span>
                      <span className="font-semibold">{formatNaira(1200)}</span>
                    </li>
                    <li className="flex items-center justify-between border-b border-line/80 pb-2">
                      <span className="inline-flex items-center gap-2">
                        <Sim className="h-3.5 w-3.5 text-lav-600" /> eSIM 1GB · 7d
                      </span>
                      <span className="font-semibold">{formatNaira(4500)}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-lav-600" /> Proxy 1GB
                      </span>
                      <span className="font-semibold">{formatNaira(3500)}</span>
                    </li>
                  </ul>
                  <Link
                    href="/signup"
                    className="btn btn-dark mt-5 w-full !py-3 !text-[0.82rem]"
                  >
                    Start with a top-up
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={140}>
                <div className="rounded-2xl border border-line bg-white/70 p-5">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
                    Delivery windows
                  </p>
                  <div className="mt-3 space-y-2.5 text-[0.82rem]">
                    {[
                      { label: "Numbers", value: "Instant · 20 min code window" },
                      { label: "eSIM", value: "Instant QR + manual details" },
                      { label: "Proxies", value: "Instant credentials" },
                      { label: "Email OTP", value: "Inbox live in seconds" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start justify-between gap-3">
                        <span className="text-ink-2">{item.label}</span>
                        <span className="text-right font-medium text-ink">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <span className="eyebrow justify-center">Why it&apos;s reliable</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-3 text-[2rem] font-medium leading-[1.08] sm:text-[2.5rem]">
                The trust is in the{" "}
                <span className="text-display italic text-lav-700">plumbing.</span>
              </h2>
            </Reveal>
          </div>
          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {protections.map((item, index) => {
              const Icon = item.icon;
              return (
                <Reveal key={item.title} delay={index * 60}>
                  <div className="h-full rounded-2xl border border-line bg-[#fffdfa] p-5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-lav-50 text-lav-700">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="mt-3.5 text-[0.94rem] font-semibold">{item.title}</h3>
                    <p className="mt-1.5 text-[0.81rem] leading-relaxed text-ink-2">{item.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-12">
        <div className="shell grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <Reveal>
              <span className="eyebrow">Questions</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-3 text-[1.9rem] font-medium leading-[1.1]">
                Details people
                <br />
                <span className="text-display italic text-lav-700">want to check.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <Link href="/contact" className="btn btn-ghost mt-5">
                Ask us directly
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
          <Reveal delay={70}>
            <FaqAccordion items={faqs} defaultOpen={null} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
