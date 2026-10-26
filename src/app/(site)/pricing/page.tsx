import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { Monogram } from "@/components/brand/Logo";
import {
  ArrowRight,
  Card,
  Check,
  Clock,
  Mail,
  Phone,
  Shield,
  Sim,
  Globe,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { formatNaira, plansFor, services, type ServiceSlug } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Pricing — straight Naira prices",
  description:
    "The full Pryva price list in Naira: virtual numbers from ₦1,200, eSIM bundles from ₦4,500, residential proxies from ₦3,500 per GB and email OTP from ₦700.",
};

const icons = {
  numbers: Phone,
  esim: Sim,
  proxies: Globe,
  "email-otp": Mail,
} as const;

const tiers = [
  {
    name: "Pay as you go",
    price: "No monthly fee",
    note: "Top up from ₦2,000 whenever you need something.",
    features: [
      "Every number, eSIM, proxy and inbox",
      "Wallet top-ups by transfer or card",
      "Auto-refund protection included",
      "Email support within 24 hours",
    ],
    featured: false,
    cta: { href: "/signup", label: "Create account" },
  },
  {
    name: "Pryva Plus",
    price: `${formatNaira(12000)} / month`,
    note: "For founders, marketers and creators who verify weekly.",
    features: [
      "₦12,000 wallet credit each month",
      "10% off numbers and email inboxes",
      "Priority non-VoIP pool",
      "Support replies in under 2 hours",
    ],
    featured: true,
    cta: { href: "/signup", label: "Start with Plus" },
  },
  {
    name: "Pryva Business",
    price: `${formatNaira(35000)} / month`,
    note: "For teams running growth, QA, research or ad ops.",
    features: [
      "₦35,000 wallet credit each month",
      "15% off the whole catalogue",
      "Dedicated Nigerian proxy pool",
      "Account manager on WhatsApp",
    ],
    featured: false,
    cta: { href: "/contact", label: "Talk to us" },
  },
];

const pricingFaqs = [
  {
    q: "Do plan credits roll over?",
    a: "Credits stay in your wallet and roll over for 90 days. The discount attached to your plan applies for as long as the plan is active.",
  },
  {
    q: "How do I pay for a plan?",
    a: "Fund your wallet by Nigerian bank transfer or local card, then start the plan from your dashboard. No international card or dollar conversion is needed at any point.",
  },
  {
    q: "Are there any extra fees?",
    a: "The price you see is the price you pay. Number, eSIM and inbox prices already include provisioning. Proxy bandwidth is sold per GB, with no per-request surcharge.",
  },
  {
    q: "What if a code doesn't arrive?",
    a: "Every number order carries auto-refund protection. When the delivery window closes without a code, you can request a refund from the order page and the full amount returns to your wallet instantly.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="relative grain overflow-hidden pb-12 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[26rem] w-[40rem] -translate-x-1/2 rounded-full bg-lav-200/40 blur-[120px]" />
        <div className="shell relative">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <span className="eyebrow justify-center">
                <Sparkle className="h-3 w-3" /> Pricing
              </span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="mt-4 text-[2.5rem] font-medium leading-[1.03] tracking-[-0.035em] sm:text-[3.4rem]">
                Honest prices,
                <br />
                <span className="text-display italic text-lav-700">in the currency you earn.</span>
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mx-auto mt-5 max-w-xl text-[1rem] leading-relaxed text-ink-2">
                Every price below is final, in Naira. Fund your wallet once, then buy whatever you
                need — numbers, eSIM data, proxy bandwidth or temporary inboxes.
              </p>
            </Reveal>
            <Reveal delay={170}>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-[0.78rem] text-ink-2">
                {[
                  { icon: Wallet, label: "Bank transfer & card" },
                  { icon: Clock, label: "Instant delivery" },
                  { icon: Shield, label: "Auto-refund protection" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <span
                      key={item.label}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1.5"
                    >
                      <Icon className="h-3.5 w-3.5 text-lav-600" />
                      {item.label}
                    </span>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="pb-16 pt-4">
        <div className="shell grid gap-4 lg:grid-cols-3">
          {tiers.map((tier, index) => (
            <Reveal key={tier.name} delay={index * 70}>
              <div
                className={`relative flex h-full flex-col rounded-[1.75rem] border p-6 ${
                  tier.featured
                    ? "border-lav-300 bg-gradient-to-br from-lav-100 via-[#fbf7ff] to-white shadow-[var(--shadow-card)]"
                    : "border-line bg-white/60"
                }`}
              >
                {tier.featured && (
                  <span className="absolute -top-3 left-6 rounded-full bg-ink px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-white">
                    Most chosen
                  </span>
                )}
                <p className="text-[1rem] font-semibold">{tier.name}</p>
                <p className="mt-2 text-[1.7rem] font-medium tracking-tight">{tier.price}</p>
                <p className="mt-1.5 text-[0.83rem] leading-relaxed text-ink-2">{tier.note}</p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-[0.85rem] leading-snug text-ink-2"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={tier.cta.href}
                  className={`btn mt-6 ${tier.featured ? "btn-primary" : "btn-ghost"}`}
                >
                  {tier.cta.label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-4 md:grid-cols-2">
            {services.map((service, index) => {
              const Icon = icons[service.slug as ServiceSlug];
              const plans = plansFor(service.slug);
              return (
                <Reveal key={service.slug} delay={index * 60}>
                  <div className="h-full rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-lav-50 text-lav-700">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <h2 className="text-[1.02rem] font-semibold">{service.name}</h2>
                          <p className="text-[0.72rem] text-ink-3">{service.eyebrow}</p>
                        </div>
                      </div>
                      <Link
                        href={service.href}
                        className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-3 transition-colors hover:border-lav-300 hover:text-lav-700"
                        aria-label={`Go to ${service.name}`}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    <div className="mt-4 divide-y divide-line/80">
                      {plans.map((plan) => (
                        <div
                          key={plan.slug}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[0.83rem] font-medium text-ink">
                              {plan.flag && <span className="mr-1.5">{plan.flag}</span>}
                              {plan.name} · {plan.planLabel}
                            </p>
                            <p className="truncate text-[0.68rem] text-ink-3">{plan.duration}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-[0.85rem] font-semibold">
                              {formatNaira(plan.price)}
                            </span>
                            {plan.compareAt && (
                              <span className="hidden text-[0.66rem] text-ink-3 line-through sm:inline">
                                {formatNaira(plan.compareAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <Link
                      href={`${service.href}#buy`}
                      className="mt-4 inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-lav-700 hover:underline"
                    >
                      Buy {service.shortName.toLowerCase()}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[1.75rem] border border-lav-200/70 bg-gradient-to-br from-lav-100/70 via-cream to-white p-6 sm:p-9">
              <Monogram className="pointer-events-none absolute -right-6 -top-10 h-48 w-48 opacity-[0.06]" />
              <div className="relative grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-center">
                <div>
                  <span className="eyebrow">Payments &amp; refunds</span>
                  <h2 className="mt-3 text-[1.7rem] font-medium leading-[1.1]">
                    Fund once.{" "}
                    <span className="text-display italic text-lav-700">Refunds are automatic.</span>
                  </h2>
                  <p className="mt-3 max-w-sm text-[0.88rem] leading-relaxed text-ink-2">
                    Top up your wallet by Nigerian bank transfer or card. Unused funds stay in your
                    wallet, and undelivered codes are refunded to the same balance without a ticket.
                  </p>
                </div>
                <div className="grid gap-2.5">
                  {[
                    {
                      icon: Card,
                      title: "Bank transfer or local card",
                      body: "Top up from ₦2,000. Balance is available immediately.",
                    },
                    {
                      icon: Shield,
                      title: "Auto-refund on undelivered codes",
                      body: "Delivery windows are shown on every order. One tap returns the funds.",
                    },
                    {
                      icon: Wallet,
                      title: "Credits roll over for 90 days",
                      body: "Unspent wallet balance and plan credits don't vanish monthly.",
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.title}
                        className="flex items-start gap-3 rounded-xl border border-white bg-white/80 px-4 py-3"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-lav-50 text-lav-700">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-[0.83rem] font-semibold text-ink">{item.title}</p>
                          <p className="text-[0.76rem] text-ink-2">{item.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="pb-8">
        <div className="shell grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <Reveal>
              <span className="eyebrow">Pricing questions</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-3 text-[1.9rem] font-medium leading-[1.1]">
                Before you
                <br />
                <span className="text-display italic text-lav-700">top up.</span>
              </h2>
            </Reveal>
          </div>
          <Reveal delay={70}>
            <FaqAccordion items={pricingFaqs} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
