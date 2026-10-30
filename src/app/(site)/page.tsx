import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PHOTOS } from "@/lib/photos";
import { Reveal } from "@/components/ui/Reveal";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { ServiceIcon } from "@/components/ServiceIcon";
import { BrandIcon } from "@/components/BrandIcon";
import { PLATFORM_SHOWCASE } from "@/lib/platform-showcase";
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Card,
  Check,
  Clock,
  Copy,
  Lock,
  Phone,
  Receipt,
  Shield,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { formatNaira, plansFor, serviceMap, services } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";
import { digitalServices } from "@/lib/digital-services";
import { CountryFlag } from "@/components/CountryFlag";
import { hasCountryFlag } from "@/lib/countries";
import { BrandMark } from "@/components/brand/BrandLockup";
import { StickyMobileCta } from "@/components/site/StickyMobileCta";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
  description:
    "Explore plans for virtual numbers, eSIM data, residential proxies, email OTP and digital accounts, priced in Naira.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
    description:
      "Explore numbers, eSIM data, residential proxies, inboxes and digital accounts, priced in Naira.",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Pryva — numbers, eSIMs and proxies, priced in Naira",
      },
    ],
  },
};

const shortcutSlugs = ["numbers", "esim", "proxies", "email-otp"] as const;

const shortcuts = shortcutSlugs.map((slug) => {
  const service = serviceMap[slug];
  const notes: Record<(typeof shortcutSlugs)[number], string> = {
    numbers: "Buy or rent",
    esim: "Plan catalog",
    proxies: "Plan catalog",
    "email-otp": "Free temporary inbox",
  };
  return {
    label: service.name,
    price: service.fromPrice,
    note: notes[slug],
    href: service.href,
    service: slug,
  };
});

const features = [
  {
    title: "Pay in Naira, properly",
    body: "Top up with Paystack by bank transfer or card, then spend from a balance you control.",
    icon: Card,
    span: "md:col-span-3",
    tone: "cream" as const,
  },
  {
    title: "Support for delivery issues",
    body: "Contact support with your order reference when delivery needs review.",
    icon: Shield,
    span: "md:col-span-3",
    tone: "lav" as const,
  },
  {
    title: "Delivered automatically",
    body: "A verification number is provisioned the moment you pay, and the code appears in your dashboard.",
    icon: Bolt,
    span: "md:col-span-2",
    tone: "white" as const,
  },
  {
    title: "Explore the catalog",
    body: "Compare plan types and prices; provider compatibility has not been verified.",
    icon: Phone,
    span: "md:col-span-2",
    tone: "white" as const,
  },
  {
    title: "Review plan details",
    body: "The catalog lists single-use and rental options, with the delivery window shown before you pay.",
    icon: Clock,
    span: "md:col-span-2",
    tone: "white" as const,
  },
];

const steps = [
  {
    n: "01",
    title: "Create an account",
    body: "Sign up with your name, email and password, or use an available sign-in option.",
  },
  {
    n: "02",
    title: "Fund your wallet in Naira",
    body: "Top up with Paystack by bank transfer or card. Your wallet is credited once payment is confirmed.",
  },
  {
    n: "03",
    title: "Choose what you need",
    body: "Browse the catalog and check the current feature availability before ordering.",
  },
  {
    n: "04",
    title: "Keep your reference",
    body: "Contact support with the reference if an existing delivery needs review.",
  },
];

/**
 * Derived from the same fulfilment allowlist /status uses, never typed in.
 *
 * This row said "Paused" long after numbers became deliverable, so the footer of
 * the busiest page on the site told visitors the core product was switched off
 * while /pricing offered ten purchasable number plans with working "Get Started"
 * links. A hardcoded availability claim goes stale in one direction only: it
 * keeps saying "no" after the answer has become "yes", and it costs sales rather
 * than causing a support complaint -- which is exactly why nobody reports it.
 *
 * Safe to compute at build time even though this page is prerendered:
 * `isPlanFulfillable` reads a constant allowlist, with no env and no network.
 */
const numberPlans = plansFor("numbers");
const deliverableNumbers = numberPlans.filter((plan) => isPlanFulfillable(plan.slug)).length;
const numberFulfilment = deliverableNumbers > 0
  ? `Automatic · ${deliverableNumbers} of ${numberPlans.length} plans`
  : "Paused";

const priceRows = [
  { slug: "numbers", note: "One-time, or rent for 7–90 days" },
  { slug: "esim", note: "Catalog data plans" },
  { slug: "proxies", note: "Catalog proxy plans" },
  { slug: "email-otp", note: "Free, one inbox at a time" },
] as const;

const faqs = [
  {
    q: "Do I need a dollar card to use Pryva?",
    a: "No. Prices are shown in Naira and you top up with Paystack by bank transfer or local card.",
  },
  {
    q: "What happens if a verification code never arrives?",
    a: "Contact support with your order reference. Live order refunds require verification of the provider outcome.",
  },
  {
    q: "Are the virtual numbers real or VoIP?",
    a: "Numbers are intended for receiving SMS verification codes. Compatibility with any specific platform is not guaranteed, so check its rules before you rely on a number.",
  },
  {
    q: "Can I keep the same number for longer than one code?",
    a: "Yes. Rental plans keep the same number for 30 or 90 days, and you can re-read incoming codes while the rental is active.",
  },
  {
    q: "How quickly does delivery happen?",
    a: "A number is provisioned immediately after payment. The code itself arrives when the platform sends it, and your order page keeps checking for it.",
  },
  {
    q: "Which platforms work best with Pryva numbers?",
    a: "Compatibility varies by platform and cannot be guaranteed. Numbers are intended for receiving SMS verification codes.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

const subscriptionPlanCount = digitalServices.reduce(
  (total, service) => total + service.plans.length,
  0,
);

export default async function HomePage() {
  // Only used to decide whether a dashboard-only service card links straight in
  // or sends a signed-out visitor to sign in and come back.
  const user = await getCurrentUser().catch(() => null);

  const serviceHref = (href: string) => {
    if (!href.startsWith("/dashboard")) return href;
    return user ? href : `/login?next=${encodeURIComponent(href)}`;
  };

  return (
    <>
      <script
        type="application/ld+json"
        // FAQ markup is static and authored here, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden pb-12 pt-4 sm:pb-16 sm:pt-10">
        {/* soft brand glows, kept behind everything and cheap to paint on phones */}
        <div className="pointer-events-none absolute -left-32 -top-24 h-[22rem] w-[22rem] rounded-full bg-lav-200/50 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-56 h-[20rem] w-[20rem] rounded-full bg-peach/40 blur-[90px]" />

        <div className="shell relative">
          <div className="grid items-center gap-8 sm:gap-10 lg:grid-cols-[1.03fr_0.97fr] lg:gap-x-14 lg:gap-y-7">
            {/* --- copy + action (first thing a phone shows) --- */}
            <div className="order-1 text-center lg:col-start-1 lg:row-start-1 lg:text-left">
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-lav-200 bg-white/75 py-1 pl-1 pr-3 text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-lav-700 backdrop-blur sm:text-[0.68rem]">
                  <BrandMark size="xs" />
                  Pryva · Nigerian digital services
                </span>
              </Reveal>

              <Reveal delay={70}>
                <h1 className="mt-5 text-[clamp(2rem,8.2vw,3.9rem)] font-medium leading-[1.04] tracking-[-0.035em] sm:mt-6">
                  Numbers, data and proxies{" "}
                  <br className="hidden sm:block" />
                  <span className="text-display italic text-lav-700">without the friction.</span>
                </h1>
              </Reveal>

              <Reveal delay={130}>
                <p className="mx-auto mt-4 max-w-xl text-[0.95rem] leading-relaxed text-ink-2 sm:mt-6 sm:text-[1.05rem] lg:mx-0">
                  Virtual numbers for SMS verification, priced in Naira and provisioned the moment
                  you pay. Every order lands in one calm dashboard.
                </p>
              </Reveal>

              <Reveal delay={190}>
                <div className="mt-6 flex flex-col gap-2.5 sm:mt-7 sm:flex-row sm:items-center sm:justify-center lg:justify-start">
                  <Link
                    href="/signup"
                    className="btn btn-primary w-full !py-4 !text-[0.95rem] sm:w-auto sm:!px-6 sm:!py-3.5"
                  >
                    Create your account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/pricing"
                    className="btn btn-ghost w-full !py-4 !text-[0.95rem] sm:w-auto sm:!px-6 sm:!py-3.5"
                  >
                    See the price list
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>
            </div>

            {/* --- visual: right of the copy on desktop, directly under the CTA on phones --- */}
            <Reveal delay={160} className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <div className="relative mx-auto w-full max-w-[21rem] sm:max-w-[26rem] lg:max-w-[30rem]">
                <div className="absolute inset-x-5 top-6 bottom-20 rounded-[2.5rem] bg-gradient-to-br from-lav-300/60 via-white/30 to-peach/50 blur-sm" />

                <div className="relative overflow-hidden rounded-[1.75rem] border border-white shadow-[var(--shadow-float)] sm:rounded-[2.1rem]">
                  <Image
                    src={PHOTOS.hero.url}
                    alt={PHOTOS.hero.alt}
                    width={1080}
                    height={1260}
                    priority
                    sizes="(max-width: 640px) 88vw, (max-width: 1024px) 26rem, 30rem"
                    className="aspect-[4/4.3] w-full object-cover sm:aspect-[4/4.25] lg:aspect-[4/4.6]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/35 via-transparent to-transparent" />
                </div>
              </div>
            </Reveal>

            {/* --- proof: under the photo on phones, under the copy on desktop --- */}
            <div className="order-3 lg:col-start-1 lg:row-start-2">
              <Reveal delay={220}>
                <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.78rem] text-ink-2 sm:gap-x-5 sm:text-[0.8rem] lg:justify-start">
                  {["Naira pricing", "Support for delivery issues", "Explore number plans"].map((item) => (
                    <li key={item} className="inline-flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 shrink-0 text-lav-600" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-center text-[0.76rem] text-ink-3 lg:text-left">
                  Catalog prices in Naira · check service availability
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- QUICK SERVICE PICKER ---------- */}
      <section className="relative pb-8">
        <div className="shell">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shortcuts.map((item, index) => (
              <Reveal key={item.label} delay={index * 60}>
                <Link
                  href={item.href}
                  className="group flex h-full flex-col justify-between rounded-2xl border border-line bg-white/70 p-4 backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-lav-200 hover:bg-white hover:shadow-[var(--shadow-soft)]"
                >
                  <div className="flex items-start justify-between">
                    <ServiceIcon service={item.service} size="sm" />
                    <ArrowUpRight className="h-4 w-4 text-ink-3 transition-colors group-hover:text-lav-600" />
                  </div>
                  <div className="mt-4">
                    <p className="text-[0.88rem] font-semibold text-ink">{item.label}</p>
                    <p className="text-[0.7rem] text-ink-3">{item.note}</p>
                    <p className="mt-2 text-[0.76rem] text-ink-2">
                      {item.price === undefined ? (
                        <span className="font-semibold text-lav-700">Free</span>
                      ) : (
                        <>
                          From{" "}
                          <span className="font-semibold text-lav-700">{formatNaira(item.price)}</span>
                        </>
                      )}
                    </p>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- SERVICES ---------- */}
      <section id="services" className="py-16 sm:py-24">
        <div className="shell">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Reveal>
                <span className="eyebrow">01 / What we do</span>
              </Reveal>
              <Reveal delay={60}>
                <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.65rem]">
                  Every service.{" "}
                  <span className="text-display italic text-lav-700">One quiet dashboard.</span>
                </h2>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-4 max-w-lg text-[0.95rem] leading-relaxed text-ink-2">
                  Browse the catalog in one dashboard, with your balance, orders and delivered codes in the same place.
                </p>
              </Reveal>
            </div>
            <Reveal delay={160}>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-4 py-2.5 text-[0.82rem] font-semibold text-ink transition-colors hover:border-lav-300"
              >
                Compare all pricing
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Reveal>
          </div>

          <div className="-mx-5 mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3 sm:mx-0 sm:mt-10 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
            {services.map((service, index) => {
              const popular = plansFor(service.slug).find((plan) => plan.popular);
              const inDashboard = service.href.startsWith("/dashboard");
              return (
                <Reveal
                  key={service.slug}
                  delay={index * 50}
                  className="w-[84vw] max-w-[20rem] shrink-0 snap-center sm:w-auto sm:max-w-none"
                >
                  <Link
                    href={serviceHref(service.href)}
                    className="group relative flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-lav-200 hover:shadow-[var(--shadow-card)] sm:p-6"
                  >
                    <div className="relative flex items-start justify-between gap-4">
                      <ServiceIcon service={service.slug} size="md" />
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-2.5 py-1 text-[0.66rem] font-medium text-ink-3">
                        <Sparkle className="h-2.5 w-2.5 text-lav-500" />
                        {service.eyebrow}
                      </span>
                    </div>

                    <div className="relative mt-4 flex-1">
                      <h3 className="text-[1.2rem] font-medium tracking-tight">{service.name}</h3>
                      <p className="mt-2 text-[0.86rem] leading-relaxed text-ink-2">
                        {service.description}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {service.goodFor.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1.5 rounded-full bg-lav-50 px-2.5 py-1 text-[0.66rem] font-medium text-lav-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="relative mt-5 flex items-end justify-between gap-3 border-t border-line/80 pt-4">
                      <div className="min-w-0">
                        <p className="text-[0.78rem] text-ink-3">
                          {service.slug === "accounts" ? "See live listings"
                            : service.fromPrice === undefined ? <>
                            Free
                          </> : <>
                            Catalog from{" "}
                            <span className="text-[1rem] font-semibold text-ink">{formatNaira(service.fromPrice)}</span>{" "}
                            <span className="text-[0.72rem]">{service.unit}</span>
                          </>}
                        </p>
                        {popular && !inDashboard && (
                          <p className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-ink-3">
                            {hasCountryFlag(popular.region) && (
                              <CountryFlag region={popular.region} size={14} decorative />
                            )}
                            Popular: {popular.planLabel} · {formatNaira(popular.price)}
                          </p>
                        )}
                        {inDashboard && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-[0.68rem] font-medium text-ink-3">
                            <Lock className="h-3 w-3 text-lav-500" />
                            {user ? "Open in your dashboard" : "In your dashboard — sign in to buy"}
                          </p>
                        )}
                      </div>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-ink transition-all group-hover:border-lav-400 group-hover:bg-lav-500 group-hover:text-white">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>

          {/* Subscriptions used to be invisible: priced and purchasable, linked from nowhere. */}
          <Reveal delay={120}>
            <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-white/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[0.84rem] font-semibold text-ink">Also inside: subscriptions</p>
                <div className="flex items-center gap-2">
                  {["netflix", "spotify", "youtube", "chatgpt", "canva", "disney-plus"].map((brand) => (
                    <BrandIcon
                      key={brand}
                      brand={brand as "netflix"}
                      size={22}
                      variant="tile"
                      decorative
                    />
                  ))}
                </div>
                <p className="text-[0.78rem] text-ink-3">
                  {subscriptionPlanCount} plans, priced in Naira
                </p>
              </div>
              <Link
                href="/digital-services"
                className="inline-flex items-center gap-2 text-[0.82rem] font-semibold text-lav-700 underline-offset-4 hover:underline"
              >
                Browse subscriptions
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- ACCOUNTS MARKETPLACE ---------- */}
      <section id="accounts" className="pb-14 sm:pb-20">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[1.75rem] border border-lav-200/70 bg-gradient-to-br from-lav-100/70 via-white to-cream px-5 py-8 sm:px-8 sm:py-10">
              <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lav-300/25 blur-3xl" />
              <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-xl">
                  <span className="eyebrow">02 / Accounts marketplace</span>
                  <h2 className="mt-4 text-[1.8rem] font-medium leading-[1.1] sm:text-[2.3rem]">
                    Aged Facebook, Instagram
                    <br className="hidden sm:block" /> and TikTok accounts.
                  </h2>
                  <p className="mt-3 text-[0.92rem] leading-relaxed text-ink-2">
                    Browse listings priced in Naira. Stock and price are shown up front, and
                    delivery issues are reviewed by support.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {["facebook", "instagram", "tiktok", "x"].map((brand) => (
                      <span
                        key={brand}
                        className="inline-flex items-center gap-2 rounded-full border border-line bg-white/80 py-1.5 pl-1.5 pr-3 text-[0.76rem] font-medium text-ink-2"
                      >
                        <BrandIcon brand={brand as "facebook"} size={20} variant="tile" decorative />
                        {brand === "x" ? "X / Twitter" : brand[0].toUpperCase() + brand.slice(1)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="w-full max-w-sm rounded-2xl border border-line bg-white/85 p-5">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    Account marketplace
                  </p>
                  <p className="mt-1 text-[2rem] font-medium tracking-tight">
                    Browse listings
                  </p>
                  <p className="mt-1 text-[0.78rem] text-ink-3">
                    Final price depends on the platform, age and follower count — always shown before
                    you confirm.
                  </p>
                  <Link href="/accounts" className="btn btn-primary mt-4 w-full">
                    Browse accounts
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- PLATFORM MARQUEE ---------- */}
      <section className="overflow-hidden border-y border-line/70 bg-white/40 py-5">
        <div className="flex w-max marquee-track items-center">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="flex shrink-0 items-center gap-3 pr-3"
              aria-hidden={copy === 1 ? true : undefined}
            >
              {PLATFORM_SHOWCASE.map((platform) => (
                <span
                  key={`${copy}-${platform.brand}`}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-cream/80 py-1.5 pl-1.5 pr-3.5 text-[0.76rem] font-medium text-ink-2"
                >
                  <BrandIcon brand={platform.brand} size={20} variant="tile" decorative />
                  {platform.label}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- FEATURE BENTO ---------- */}
      <section className="py-16 sm:py-24">
        <div className="shell">
          <div className="max-w-2xl">
            <Reveal>
              <span className="eyebrow">03 / Why Pryva</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.65rem]">
                Built for how{" "}
                <br className="hidden sm:block" />
                <span className="text-display italic text-lav-700">Nigeria actually pays.</span>
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-ink-2">
                Most verification platforms assume you have a dollar card and endless patience.
                Pryva is Naira-first from the first screen to the refund.
              </p>
            </Reveal>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-6 sm:gap-4">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Reveal key={feature.title} delay={index * 60} className={feature.span}>
                  <div
                    className={`relative h-full overflow-hidden rounded-2xl border p-5 ${
                      feature.tone === "lav"
                        ? "border-lav-200 bg-gradient-to-br from-lav-100 via-[#f6f0ff] to-white"
                        : feature.tone === "cream"
                          ? "border-line bg-cream-2/70"
                          : "border-line bg-white/70"
                    }`}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/80 text-lav-700 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="mt-4 text-[0.98rem] font-semibold">{feature.title}</h3>
                    <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-2">{feature.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- DASHBOARD ---------- */}
      <section className="pb-16 sm:pb-24">
        <div className="shell">
          <div className="relative overflow-hidden rounded-[2.25rem] border border-lav-200/70 bg-gradient-to-br from-lav-100/80 via-cream to-cream-2 px-5 py-10 sm:px-10 sm:py-14">
            <div className="relative grid gap-9 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-12">
              <div>
                <Reveal>
                  <span className="eyebrow">04 / Your dashboard</span>
                </Reveal>
                <Reveal delay={60}>
                  <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.55rem]">
                    Everything you bought,{" "}
                    <br className="hidden sm:block" />
                    <span className="text-display italic text-lav-700">still within reach.</span>
                  </h2>
                </Reveal>
                <Reveal delay={120}>
                  <p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-ink-2">
                    Your dashboard brings wallet transactions, order references and delivered codes together.
                  </p>
                </Reveal>
                <Reveal delay={180}>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {[
                      "Live order details and expiry timers",
                      "Wallet top-ups and a full transaction ledger",
                      "Order references for support review",
                      "Order history you can copy from any device",
                    ].map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2.5 rounded-xl border border-line/70 bg-white/60 px-3.5 py-3 text-[0.86rem] text-ink-2"
                      >
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-lav-700 shadow-sm">
                          <Check className="h-3 w-3" />
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </div>

              {/* An honest product visual: real states the dashboard renders. */}
              <Reveal delay={140}>
                <div className="mx-auto w-full max-w-sm">
                  <div className="rounded-[1.5rem] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-3">
                        Example Order PV-2291
                      </p>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.6rem] font-semibold text-emerald-700">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                        Sample code
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-cream/60 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CountryFlag code="ng" size={22} decorative />
                        <div className="min-w-0">
                          <p className="truncate text-[0.82rem] font-semibold">+234 ••• ••• ••••</p>
                          <p className="text-[0.64rem] text-ink-3">Nigeria · sample number</p>
                        </div>
                      </div>
                      <Copy className="h-3.5 w-3.5 text-ink-3" />
                    </div>

                    <div className="mt-3 flex gap-1">
                      {["8", "1", "4", "0", "2", "7"].map((digit, index) => (
                        <span
                          key={index}
                          className={`grid h-8 flex-1 place-items-center rounded-md border text-[0.85rem] font-semibold ${
                            index === 5
                              ? "border-lav-400 bg-white text-lav-700 shadow-sm"
                              : "border-line bg-white/80 text-ink"
                          }`}
                        >
                          {digit}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[0.66rem] text-ink-3">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Expires in 00:19
                      </span>
                      <span>Copy to clipboard</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-start gap-3 rounded-2xl border border-line bg-white/85 p-3.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-lav-50 text-lav-700">
                      <Shield className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[0.78rem] font-semibold">Order support</p>
                      <p className="text-[0.7rem] leading-relaxed text-ink-3">
                        If delivery is uncertain, contact support with your order reference.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-start gap-3 rounded-2xl border border-line bg-white/85 p-3.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-lav-50 text-lav-700">
                      <Wallet className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[0.78rem] font-semibold">Wallet {formatNaira(12500)}</p>
                      <p className="text-[0.7rem] leading-relaxed text-ink-3">
                        Every top-up, purchase and refund lands in one ledger.
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how-it-works" className="pb-16 sm:pb-24">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <span className="eyebrow">05 / How it works</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.6rem]">
                Four steps.{" "}
                <span className="text-display italic text-lav-700">
                  Mostly waiting for the code.
                </span>
              </h2>
            </Reveal>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <Reveal key={step.n} delay={index * 70}>
                <div className="relative h-full rounded-2xl border border-line bg-white/60 p-5">
                  <span className="text-display text-[2.4rem] leading-none text-lav-300">
                    {step.n}
                  </span>
                  <h3 className="mt-3 text-[0.98rem] font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-[0.84rem] leading-relaxed text-ink-2">{step.body}</p>
                  {index < steps.length - 1 && (
                    <span className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 place-items-center rounded-full bg-white text-lav-500 shadow-sm lg:grid">
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-line bg-cream-2/60 px-5 py-5 sm:flex-row sm:items-center">
              <p className="flex items-start gap-3 text-[0.86rem] text-ink-2">
                <Shield className="mt-0.5 h-5 w-5 shrink-0 text-lav-600" />
                <span>
                  <span className="font-semibold text-ink">Refund review:</span> contact support
                  with your order reference when delivery cannot be confirmed.
                </span>
              </p>
              <Link href="/signup" className="btn btn-primary shrink-0 !px-5 !py-2.5 !text-[0.82rem]">
                Try it now
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- PRICING: what things actually cost today ---------- */}
      <section id="pricing" className="pb-16 sm:pb-24">
        <div className="shell">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <Reveal>
                <span className="eyebrow">06 / Pricing</span>
              </Reveal>
              <Reveal delay={60}>
                <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.6rem]">
                  Pay per purchase.{" "}
                  <span className="text-display italic text-lav-700">Nothing monthly.</span>
                </h2>
              </Reveal>
            </div>
            <Reveal delay={100}>
              <p className="max-w-sm text-[0.88rem] leading-relaxed text-ink-3">
                Catalog prices are quoted in Naira. Review provider payment terms and service availability before confirming.
              </p>
            </Reveal>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <Reveal>
              <div className="rounded-[1.75rem] border border-line bg-white/70 p-2">
                {priceRows.map((row) => {
                  const service = serviceMap[row.slug];
                  return (
                    <Link
                      key={row.slug}
                      href={service.href}
                      className="group flex items-center gap-3 rounded-2xl px-3 py-3.5 transition-colors hover:bg-cream-2/70 sm:px-4"
                    >
                      <ServiceIcon service={row.slug} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.9rem] font-semibold text-ink">{service.name}</p>
                        <p className="truncate text-[0.74rem] text-ink-3">{row.note}</p>
                      </div>
                      <div className="text-right">
                        {service.fromPrice === undefined ? (
                          <p className="text-[0.95rem] font-semibold text-lav-700">Free</p>
                        ) : (
                          <>
                            <p className="text-[0.66rem] uppercase tracking-[0.1em] text-ink-3">from</p>
                            <p className="text-[0.95rem] font-semibold text-ink">
                              {formatNaira(service.fromPrice)}
                            </p>
                          </>
                        )}
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-3 transition-colors group-hover:text-lav-600" />
                    </Link>
                  );
                })}
                <p className="px-4 py-3 text-[0.74rem] text-ink-3">
                  Gift cards, data plans, bulk and scheduled purchases are priced inside your
                  dashboard, from the same wallet.
                </p>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="flex h-full flex-col justify-between rounded-[1.75rem] border border-lav-300 bg-gradient-to-br from-lav-100 via-[#faf6ff] to-white p-6">
                <div>
                  <ul className="space-y-3">
                    {[
                      "Review prices before checkout",
                      "Wallet top-ups from ₦1,000",
                      "Support for delivery issues",
                      "Prices fixed in Naira at checkout",
                    ].map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-[0.86rem] leading-snug text-ink-2"
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 flex items-start gap-2 rounded-xl border border-line/70 bg-white/70 px-3 py-2.5 text-[0.74rem] leading-relaxed text-ink-3">
                    <Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                    Prices are fixed in Naira and shown before you pay. Categories we cannot deliver reliably are marked unavailable rather than sold.
                  </p>
                </div>
                <Link href="/pricing" className="btn btn-primary mt-6 w-full">
                  See the full price list
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="pb-16 sm:pb-24">
        <div className="shell grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <Reveal>
              <span className="eyebrow">08 / Questions</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.5rem]">
                The things people{" "}
                <br className="hidden sm:block" />
                <span className="text-display italic text-lav-700">ask us first.</span>
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-sm text-[0.9rem] leading-relaxed text-ink-2">
                Still unsure? Contact support with your question or order reference.
              </p>
            </Reveal>
            <Reveal delay={160}>
              <Link href="/contact" className="btn btn-ghost mt-6">
                Contact support
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
          <Reveal delay={80}>
            <FaqAccordion items={faqs} />
          </Reveal>
        </div>
      </section>

      {/* ---------- CLOSING CTA ---------- */}
      <section id="final-cta" className="pb-10 sm:pb-16">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2.25rem] bg-ink px-6 py-12 text-white sm:px-12 sm:py-16">
              <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-lav-500/30 blur-[90px]" />
              <div className="pointer-events-none absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-lav-400/25 blur-[90px]" />
              <div className="pointer-events-none absolute -right-10 -top-8 hidden opacity-[0.16] sm:block">
                <BrandMark size="xl" className="drop-shadow-[0_24px_60px_rgba(139,92,246,0.45)]" />
              </div>

              <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 py-1 pl-1 pr-3 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-white/80">
                    <BrandMark size="xs" />
                    Ready when you are
                  </span>
                  <h2 className="mt-5 max-w-lg text-[2rem] font-medium leading-[1.06] sm:text-[2.7rem]">
                    Your next verification{" "}
                    <br className="hidden sm:block" />
                    can take{" "}
                    <span className="text-display italic text-lav-200">two minutes.</span>
                  </h2>
                  <p className="mt-4 max-w-md text-[0.92rem] leading-relaxed text-white/70">
                    Create an account to fund your wallet, order a number and keep every
                    delivered code in one place.
                  </p>
                  <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
                    <Link
                      href="/signup"
                      className="btn bg-white !px-6 !py-3.5 text-ink hover:bg-lav-50"
                    >
                      Create free account
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/how-it-works"
                      className="btn border border-white/25 !px-6 !py-3.5 text-white hover:bg-white/10"
                    >
                      See how it works
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-white/55">
                    <span className="inline-flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" /> Payments via Paystack
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Naira only</span>
                    <span aria-hidden="true">·</span>
                    <Link
                      href="/refund-policy"
                      className="underline decoration-white/30 underline-offset-4 hover:text-white"
                    >
                      Refund policy
                    </Link>
                  </p>
                </div>

                <div className="grid gap-2.5">
                  {[
                    { label: "Number fulfillment", value: numberFulfilment },
                    { label: "Payments", value: "Bank transfer or card" },
                    { label: "Refunds", value: "Reviewed by support" },
                    { label: "Coverage", value: "Numbers, eSIM, proxies, accounts" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <span className="text-[0.68rem] uppercase tracking-[0.12em] text-white/50">
                        {item.label}
                      </span>
                      <span className="text-right text-[0.78rem] font-medium text-white/90">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <StickyMobileCta
        label="Explore plans · Naira pricing"
        price={serviceMap["email-otp"].fromPrice}
        targetId="final-cta"
      />
    </>
  );
}
