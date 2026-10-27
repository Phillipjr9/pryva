import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PHOTOS } from "@/lib/photos";
import { Reveal } from "@/components/ui/Reveal";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { ServiceIcon } from "@/components/ServiceIcon";
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Card,
  Check,
  Clock,
  Copy,
  Globe,
  Grid,
  Mail,
  Phone,
  Receipt,
  Refresh,
  Shield,
  Sim,
  Sparkle,
  Star,
  Wallet,
} from "@/components/icons";
import { formatNaira, plansFor, services } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
  description:
    "Buy and rent real virtual numbers, eSIM data, residential proxies and email OTP. Pay in Naira, get instant delivery, and enjoy automatic refunds if a code doesn't arrive.",
};

const serviceIcons = {
  numbers: Phone,
  esim: Sim,
  proxies: Globe,
  "email-otp": Mail,
  data: Phone,
  "gift-cards": Sparkle,
  bulk: Receipt,
  scheduled: Clock,
} as const;

const shortcuts = [
  {
    label: "Virtual numbers",
    price: plansFor("numbers")[0]?.price ?? 1200,
    note: "Buy or rent",
    href: "/virtual-numbers",
    service: "numbers" as const,
  },
  {
    label: "eSIM data",
    price: plansFor("esim")[0]?.price ?? 4500,
    note: "190+ destinations",
    href: "/esim",
    service: "esim" as const,
  },
  {
    label: "Residential proxies",
    price: plansFor("proxies")[0]?.price ?? 3500,
    note: "Nigeria-first pool",
    href: "/proxies",
    service: "proxies" as const,
  },
  {
    label: "Email OTP",
    price: plansFor("email-otp")[0]?.price ?? 700,
    note: "Temporary inboxes",
    href: "/email-otp",
    service: "email-otp" as const,
  },
];

const platforms = [
  "WhatsApp",
  "Telegram",
  "Google",
  "Binance",
  "TikTok",
  "Instagram",
  "PayPal",
  "Discord",
  "Uber",
  "X",
  "Netflix",
  "Snapchat",
  "Tinder",
  "OKX",
  "Facebook",
  "Spotify",
];

const features = [
  {
    title: "Pay in Naira, properly",
    body: "Fund your wallet with a Nigerian bank transfer or card. No dollar card, no conversion surprises, no failed checkouts.",
    icon: Card,
    span: "md:col-span-3",
    tone: "cream" as const,
  },
  {
    title: "Auto-refund if no code",
    body: "If a verification code doesn't arrive in the delivery window, one tap sends the money back to your wallet.",
    icon: Shield,
    span: "md:col-span-3",
    tone: "lav" as const,
  },
  {
    title: "Instant delivery",
    body: "Numbers, inboxes and eSIM QR codes appear the moment payment clears.",
    icon: Bolt,
    span: "md:col-span-2",
    tone: "white" as const,
  },
  {
    title: "Real non-VoIP lines",
    body: "Carrier-grade numbers from Fleexa's network, not recycled VoIP stock.",
    icon: Phone,
    span: "md:col-span-2",
    tone: "white" as const,
  },
  {
    title: "Built to rent long-term",
    body: "Keep the same number for 7, 30 or 90 days and receive codes all month.",
    icon: Clock,
    span: "md:col-span-2",
    tone: "white" as const,
  },
];

const steps = [
  {
    n: "01",
    title: "Create an account",
    body: "Sign up with your name and email. It takes less than a minute — no documents needed.",
  },
  {
    n: "02",
    title: "Fund your wallet in Naira",
    body: "Top up by bank transfer or card. Your balance is ready to spend immediately.",
  },
  {
    n: "03",
    title: "Choose what you need",
    body: "Pick a number, eSIM bundle, proxy pack or temp inbox from the dashboard.",
  },
  {
    n: "04",
    title: "Get it instantly",
    body: "Codes, activation details and credentials appear in your dashboard right away.",
  },
];

const tiers = [
  {
    name: "Pay as you go",
    price: "No monthly fee",
    blurb: "For one-off verifications and testing a new market.",
    features: [
      "Any number, eSIM or proxy pack",
      "Wallet top-ups from ₦2,000",
      "Auto-refund protection",
      "Email support",
    ],
    cta: "Top up and buy",
    featured: false,
  },
  {
    name: "Pryva Plus",
    price: `${formatNaira(12000)}/mo`,
    blurb: "For founders and marketers who verify every week.",
    features: [
      "₦12,000 wallet credit every month",
      "10% off all numbers and inboxes",
      "Priority number pool",
      "Priority support in under 2 hours",
    ],
    cta: "Start with Plus",
    featured: true,
  },
  {
    name: "Business",
    price: `${formatNaira(35000)}/mo`,
    blurb: "For teams running growth, QA and research at scale.",
    features: [
      "₦35,000 monthly wallet credit",
      "15% off everything + shared team wallet",
      "Dedicated Nigerian proxy pool",
      "Account manager on WhatsApp",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

const testimonials = [
  {
    quote:
      "The auto-refund is the part that keeps me here. I try a platform, the code doesn't land, money comes back. No support ticket, no arguing.",
    name: "Tola A.",
    role: "Growth marketer · Lagos",
    avatar: PHOTOS.testimonials.tola.url,
    avatarAlt: PHOTOS.testimonials.tola.alt,
  },
  {
    quote:
      "I bought a Nigerian number on a Friday night to rent for 30 days. It worked first try on WhatsApp Business and I still have it.",
    name: "Chidera O.",
    role: "Founder · Enugu",
    avatar: PHOTOS.testimonials.chidera.url,
    avatarAlt: PHOTOS.testimonials.chidera.alt,
  },
  {
    quote:
      "The eSIM installed before my flight finished boarding. Landed in London with data and didn't touch a roaming plan.",
    name: "Ifeanyi M.",
    role: "Product designer · Abuja",
    avatar: PHOTOS.testimonials.ifeanyi.url,
    avatarAlt: PHOTOS.testimonials.ifeanyi.alt,
  },
];

const faqs = [
  {
    q: "Do I need a dollar card to use Pryva?",
    a: "No. Pryva prices everything in Naira. Fund your wallet with a Nigerian bank transfer or a local card, then pay from that balance. You never need a foreign card.",
  },
  {
    q: "What happens if a verification code never arrives?",
    a: "Every number order carries auto-refund protection. If no code arrives within the delivery window, open the order and tap Request auto-refund — the full amount returns to your wallet instantly, no ticket needed.",
  },
  {
    q: "Are the virtual numbers real or VoIP?",
    a: "They are real, carrier-grade numbers sourced through our provider Fleexa. Being non-VoIP is precisely why platforms like WhatsApp, Telegram and Google accept them far more reliably.",
  },
  {
    q: "Can I keep the same number for longer than one code?",
    a: "Yes. Choose a 7, 30 or 90-day rental. The line stays yours, so you can receive multiple SMS codes, keep a business identity consistent and renew whenever you need.",
  },
  {
    q: "How quickly does delivery happen?",
    a: "Instantly, in the same session. Number orders display the line and codes in your dashboard, eSIMs show a QR code and activation details, and proxy credentials are issued immediately after payment.",
  },
  {
    q: "Which platforms work best with Pryva numbers?",
    a: "WhatsApp, Telegram, Google, TikTok, Binance, Discord and most fintech apps work well with our Nigerian and international lines. A few platforms block shared numbers; if that happens, your order is refundable.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="relative grain overflow-hidden pb-16 pt-10 sm:pt-16">
        <div className="pointer-events-none absolute left-[-12rem] top-[-6rem] h-[30rem] w-[30rem] rounded-full bg-lav-200/45 blur-[110px]" />
        <div className="pointer-events-none absolute right-[-8rem] top-[16rem] h-[26rem] w-[26rem] rounded-full bg-peach/50 blur-[100px]" />

        <div className="shell relative">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-lav-200 bg-white/70 px-3.5 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-lav-700 backdrop-blur">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ring rounded-full bg-lav-500" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lav-600" />
                  </span>
                  Simple. Secure. Scalable.
                </span>
              </Reveal>

              <Reveal delay={80}>
                <h1 className="mt-6 text-[clamp(2.25rem,6vw,3.9rem)] font-medium leading-[1.03] tracking-[-0.035em]">
                  Numbers, data and
                  <br className="hidden sm:block" /> proxies —{" "}
                  <span className="text-display italic text-lav-700">without the friction.</span>
                </h1>
              </Reveal>

              <Reveal delay={140}>
                <p className="mt-6 max-w-xl text-[1rem] leading-relaxed text-ink-2 sm:text-[1.06rem]">
                  Pryva is the calm way for Nigerians to verify accounts, stay connected abroad and
                  run research. Real virtual numbers, eSIM data, residential proxies and temporary
                  inboxes — all paid in Naira, delivered in seconds.
                </p>
              </Reveal>

              <Reveal delay={200}>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link href="/signup" className="btn btn-primary !px-6 !py-3.5">
                    Create your account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/pricing" className="btn btn-ghost !px-6 !py-3.5">
                    Explore services
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={260}>
                <ul className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8rem] text-ink-2">
                  {[
                    "Instant delivery",
                    "Auto-refund if no code",
                    "Real non-VoIP numbers",
                  ].map((item) => (
                    <li key={item} className="inline-flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-lav-600" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal delay={320}>
                <div className="mt-9 flex items-center gap-4 border-t border-line/80 pt-5">
                  <div className="flex -space-x-2.5">
                    {PHOTOS.socialProof.map((photo) => (
                      <Image
                        key={photo.url}
                        src={photo.url}
                        alt={photo.alt}
                        width={72}
                        height={72}
                        className="h-9 w-9 rounded-full border-2 border-cream object-cover shadow-sm"
                      />
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-lav-500">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star key={index} className="h-3 w-3" />
                      ))}
                      <span className="ml-1 text-[0.72rem] font-semibold text-ink">4.9/5</span>
                    </div>
                    <p className="text-[0.74rem] text-ink-3">
                      4,200+ numbers delivered · Lagos, Abuja, Port Harcourt
                    </p>
                  </div>
                </div>
              </Reveal>
            </div>

            {/* hero visual */}
            <Reveal delay={180} className="relative">
              <div className="relative mx-auto max-w-[26rem] lg:max-w-[30rem]">
                <div className="absolute inset-x-6 top-8 bottom-24 rounded-[2.5rem] bg-gradient-to-br from-lav-200/70 via-white/40 to-peach/50 blur-[2px]" />

                <div className="relative overflow-hidden rounded-[2.1rem] border border-white shadow-[var(--shadow-float)]">
                  <Image
                    src={PHOTOS.hero.url}
                    alt={PHOTOS.hero.alt}
                    width={1080}
                    height={1260}
                    priority
                    className="aspect-[4/4.4] w-full object-cover sm:aspect-[4/4.25] lg:aspect-[4/4.6]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/25 via-transparent to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-br from-lav-200/20 via-transparent to-transparent" />

                  <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/85 px-3 py-2 shadow-sm backdrop-blur-md sm:left-5 sm:top-5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ring rounded-full bg-emerald-500" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    </span>
                    <span className="text-[0.66rem] font-semibold text-ink">
                      Adaeze · Surulere — verified in 9s
                    </span>
                  </span>

                </div>

                {/* floating wallet card */}
                <div className="absolute -left-1 top-14 z-20 hidden w-[9.5rem] rounded-2xl border border-white bg-white/95 p-3.5 shadow-[var(--shadow-soft)] backdrop-blur sm:block lg:-left-4">
                  <div className="flex items-center justify-between">
                    <Wallet className="h-4 w-4 text-lav-600" />
                    <span className="text-[0.55rem] font-semibold text-emerald-600">Funded</span>
                  </div>
                  <p className="mt-2 text-[0.55rem] uppercase tracking-[0.12em] text-ink-3">
                    Wallet balance
                  </p>
                  <p className="text-[0.95rem] font-semibold">{formatNaira(12500)}</p>
                </div>

                <div className="relative z-10 -mt-24 mx-3 rounded-[1.75rem] border border-white/90 bg-white/85 p-5 shadow-[var(--shadow-float)] backdrop-blur-xl sm:-mt-28 sm:mx-5 lg:ml-8 lg:-mr-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                      Live verification
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-lav-50 px-2 py-1 text-[0.62rem] font-semibold text-lav-700">
                      <Clock className="h-2.5 w-2.5" /> 00:19
                    </span>
                  </div>

                  <div className="mt-4 rounded-2xl border border-line bg-cream/70 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[1rem] shadow-sm">
                          🇳🇬
                        </span>
                        <div>
                          <p className="text-[0.92rem] font-semibold tracking-tight">
                            +234 812 445 9081
                          </p>
                          <p className="text-[0.68rem] text-ink-3">
                            Nigeria · non-VoIP · WhatsApp ready
                          </p>
                        </div>
                      </div>
                      <Copy className="h-4 w-4 text-ink-3" />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {["WhatsApp", "Telegram", "Google", "Binance"].map((platform) => (
                      <span
                        key={platform}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[0.64rem] font-medium text-ink-2"
                      >
                        {platform}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 rounded-2xl bg-gradient-to-br from-lav-50 to-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
                        Verification code
                      </p>
                      <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-emerald-600">
                        <Check className="h-3 w-3" /> Arrived in 12s
                      </span>
                    </div>
                    <div className="mt-3 flex gap-1.5">
                      {["4", "8", "2", "0", "6", "9"].map((digit, index) => (
                        <span
                          key={index}
                          className={`grid h-10 flex-1 place-items-center rounded-lg border text-[1rem] font-semibold ${
                            index === 5
                              ? "border-lav-400 bg-white text-lav-700 shadow-sm"
                              : "border-line bg-white/80 text-ink"
                          }`}
                        >
                          {digit}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5 text-white">
                    <span className="text-[0.72rem] font-medium">Auto-refund protection</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[0.6rem] font-semibold">
                      <Shield className="h-2.5 w-2.5" /> Active
                    </span>
                  </div>
                </div>

                {/* floating eSIM card */}
                <div className="animate-floaty absolute -bottom-7 right-0 z-20 w-[10.5rem] rounded-2xl border border-white bg-white/95 p-3.5 shadow-[var(--shadow-soft)] backdrop-blur sm:right-2">
                  <div className="flex items-center justify-between">
                    <Sim className="h-4 w-4 text-lav-600" />
                    <span className="text-[0.55rem] font-bold uppercase tracking-[0.12em] text-ink-3">
                      eSIM
                    </span>
                  </div>
                  <p className="mt-2 text-[0.78rem] font-semibold">Europe · 5GB</p>
                  <p className="text-[0.62rem] text-ink-3">Installed · 30 days</p>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-lav-100">
                    <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-lav-400 to-lav-600" />
                  </div>
                </div>

              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- QUICK SERVICE PICKER ---------- */}
      <section className="relative pb-6">
        <div className="shell">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shortcuts.map((item, index) => {
              return (
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
                        From{" "}
                        <span className="font-semibold text-lav-700">{formatNaira(item.price)}</span>
                      </p>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- PLATFORM MARQUEE ---------- */}
      <section className="overflow-hidden border-y border-line/70 bg-white/40 py-5">
        <div className="flex w-max marquee-track items-center gap-3">
          {[...platforms, ...platforms].map((platform, index) => (
            <span
              key={`${platform}-${index}`}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-cream/80 px-3.5 py-1.5 text-[0.76rem] font-medium text-ink-2"
            >
              {platform}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- SERVICES ---------- */}
      <section className="py-20 sm:py-24">
        <div className="shell">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Reveal>
                <span className="eyebrow">01 / What we do</span>
              </Reveal>
              <Reveal delay={60}>
                <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.65rem]">
                  Four services.{" "}
                  <span className="text-display italic text-lav-700">One quiet dashboard.</span>
                </h2>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-4 max-w-lg text-[0.95rem] leading-relaxed text-ink-2">
                  Everything is priced honestly in Naira and delivered instantly. Pick what you need
                  today — your history, codes and credentials stay in one place.
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

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {services.map((service, index) => {
              const popular = plansFor(service.slug).find((plan) => plan.popular);
              return (
                <Reveal key={service.slug} delay={index * 70}>
                  <Link
                    href={service.href}
                    className="group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-lav-200 hover:shadow-[var(--shadow-card)] sm:p-7"
                  >
                    <div className="relative flex items-start justify-between gap-4">
                      <ServiceIcon service={service.slug as any} size="md" />
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-2.5 py-1 text-[0.66rem] font-medium text-ink-3">
                        <Sparkle className="h-2.5 w-2.5 text-lav-500" />
                        {service.eyebrow}
                      </span>
                    </div>
                    <div className="relative mt-5 flex-1">
                      <h3 className="text-[1.35rem] font-medium tracking-tight">{service.name}</h3>
                      <p className="mt-2 max-w-md text-[0.9rem] leading-relaxed text-ink-2">
                        {service.description}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {service.goodFor.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1.5 rounded-full bg-lav-50 px-2.5 py-1 text-[0.68rem] font-medium text-lav-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="relative mt-6 flex items-end justify-between border-t border-line/80 pt-4">
                      <p className="text-[0.78rem] text-ink-3">
                        From{" "}
                        <span className="text-[1rem] font-semibold text-ink">
                          {formatNaira(service.fromPrice)}
                        </span>{" "}
                        <span className="text-[0.72rem]">{service.unit}</span>
                        {popular && (
                          <span className="mt-1 block text-[0.7rem] text-ink-3">
                            Popular: {popular.planLabel} · {formatNaira(popular.price)}
                          </span>
                        )}
                      </p>
                      <span className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink transition-all group-hover:border-lav-400 group-hover:bg-lav-500 group-hover:text-white">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- FEATURE BENTO ---------- */}
      <section className="relative py-6 sm:py-10">
        <div className="shell">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Reveal>
                <span className="eyebrow">02 / Why Pryva</span>
              </Reveal>
              <Reveal delay={60}>
                <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.65rem]">
                  Built for how
                  <br />
                  <span className="text-display italic text-lav-700">Nigeria actually pays.</span>
                </h2>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-ink-2">
                  Most verification platforms assume you have a dollar card and endless patience.
                  Pryva is Naira-first from the first screen to the refund.
                </p>
              </Reveal>
              <Reveal delay={180}>
                <Link
                  href="/how-it-works"
                  className="btn btn-dark mt-7 !px-5 !py-3 !text-[0.83rem]"
                >
                  See how Pryva works
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Reveal>
            </div>

            <div className="grid gap-3 md:grid-cols-6">
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
                      <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-2">
                        {feature.body}
                      </p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- DASHBOARD PREVIEW ---------- */}
      <section className="py-20 sm:py-28">
        <div className="shell">
          <div className="relative overflow-hidden rounded-[2.25rem] border border-lav-200/70 bg-gradient-to-br from-lav-100/80 via-cream to-cream-2 px-5 py-10 sm:px-10 sm:py-14">
            <div className="relative grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
              <div>
                <Reveal>
                  <span className="eyebrow">03 / Your dashboard</span>
                </Reveal>
                <Reveal delay={60}>
                  <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.55rem]">
                    Everything you bought,
                    <br />
                    <span className="text-display italic text-lav-700">still within reach.</span>
                  </h2>
                </Reveal>
                <Reveal delay={120}>
                  <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-ink-2">
                    Codes, activation QR details and proxy credentials never disappear into an SMS
                    you forgot to screenshot. Your wallet, orders and refunds live in one calm place.
                  </p>
                </Reveal>
                <Reveal delay={180}>
                  <ul className="mt-6 space-y-3">
                    {[
                      "Live OTP codes with expiry timers",
                      "Wallet top-ups and a full transaction ledger",
                      "One-tap auto-refund on undelivered codes",
                      "Order history you can copy from any device",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-[0.88rem] text-ink-2">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-lav-700 shadow-sm">
                          <Check className="h-3 w-3" />
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </div>

              <Reveal delay={140}>
                <div className="relative">
                  <div className="rounded-[1.75rem] border border-white bg-white/85 p-4 shadow-[var(--shadow-float)] backdrop-blur-xl sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[0.72rem] font-semibold text-ink">Dashboard</span>
                      </div>
                      <span className="rounded-full bg-cream px-2.5 py-1 text-[0.62rem] font-medium text-ink-2">
                        pryva.ng
                      </span>
                    </div>

                    <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                      <div className="rounded-2xl bg-ink p-4 text-white">
                        <p className="text-[0.6rem] uppercase tracking-[0.16em] text-white/60">
                          Wallet balance
                        </p>
                        <p className="mt-1.5 text-[1.5rem] font-semibold leading-none">
                          {formatNaira(18500)}
                        </p>
                        <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[0.6rem] font-medium">
                          <Wallet className="h-2.5 w-2.5" /> Top up
                        </span>
                      </div>
                      <div className="rounded-2xl border border-line bg-cream/60 p-4">
                        <p className="text-[0.6rem] uppercase tracking-[0.16em] text-ink-3">
                          This month
                        </p>
                        <p className="mt-1.5 text-[1.5rem] font-semibold leading-none">7 orders</p>
                        <p className="mt-2 text-[0.66rem] text-ink-3">2 refunds · ₦2,400 returned</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {[
                        {
                          name: "Nigeria · 30-day rental",
                          meta: "PRY-8H42KD · +234 812 445 9081",
                          amount: 7500,
                          status: "Active",
                        },
                        {
                          name: "Europe eSIM · 5GB",
                          meta: "PRY-2M91QP · QR ready",
                          amount: 18500,
                          status: "Delivered",
                        },
                        {
                          name: "US verification",
                          meta: "PRY-7K30VF · auto-refunded",
                          amount: 1500,
                          status: "Refunded",
                        },
                      ].map((order) => (
                        <div
                          key={order.meta}
                          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[0.78rem] font-semibold text-ink">
                              {order.name}
                            </p>
                            <p className="truncate text-[0.62rem] text-ink-3">{order.meta}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[0.78rem] font-semibold">{formatNaira(order.amount)}</p>
                            <span
                              className={`text-[0.58rem] font-semibold ${
                                order.status === "Refunded"
                                  ? "text-amber-600"
                                  : order.status === "Active"
                                    ? "text-emerald-600"
                                    : "text-lav-600"
                              }`}
                            >
                              {order.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="absolute -bottom-5 -left-3 rounded-xl border border-white bg-white px-3.5 py-2.5 shadow-[var(--shadow-soft)]">
                    <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold text-ink">
                      <Refresh className="h-3 w-3 text-lav-600" />
                      Refund completed
                    </p>
                    <p className="text-[0.58rem] text-ink-3">₦1,500 back to wallet</p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section className="py-8 sm:py-12">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <span className="eyebrow">04 / How it works</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.6rem]">
                Four steps.{" "}
                <span className="text-display italic text-lav-700">Mostly waiting for the code.</span>
              </h2>
            </Reveal>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  <span className="font-semibold text-ink">Refund promise:</span> if a code never
                  arrives, you don&apos;t keep a support tab open for days. The amount returns to
                  your wallet automatically.
                </span>
              </p>
              <Link
                href="/signup"
                className="btn btn-primary shrink-0 !px-5 !py-2.5 !text-[0.82rem]"
              >
                Try it now
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- PRICING TEASER ---------- */}
      <section className="py-20 sm:py-24">
        <div className="shell">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <Reveal>
                <span className="eyebrow">05 / Pricing</span>
              </Reveal>
              <Reveal delay={60}>
                <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.6rem]">
                  Start small.{" "}
                  <span className="text-display italic text-lav-700">Scale when it works.</span>
                </h2>
              </Reveal>
            </div>
            <Reveal delay={100}>
              <p className="max-w-sm text-[0.88rem] leading-relaxed text-ink-3">
                Pay as you go from ₦700, or let a monthly plan discount everything you buy. No
                hidden conversions, no surprise fees.
              </p>
            </Reveal>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {tiers.map((tier, index) => (
              <Reveal key={tier.name} delay={index * 80}>
                <div
                  className={`relative flex h-full flex-col rounded-[1.75rem] border p-6 ${
                    tier.featured
                      ? "border-lav-300 bg-gradient-to-br from-lav-100 via-[#faf6ff] to-white shadow-[var(--shadow-card)]"
                      : "border-line bg-white/60"
                  }`}
                >
                  {tier.featured && (
                    <span className="absolute -top-3 left-6 rounded-full bg-ink px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-white">
                      Most chosen
                    </span>
                  )}
                  <p className="text-[0.95rem] font-semibold">{tier.name}</p>
                  <p className="mt-2 text-[1.65rem] font-medium tracking-tight">{tier.price}</p>
                  <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-2">{tier.blurb}</p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {tier.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-[0.84rem] leading-snug text-ink-2"
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={tier.featured ? "/signup" : "/contact"}
                    className={`btn mt-6 ${tier.featured ? "btn-primary" : "btn-ghost"}`}
                  >
                    {tier.cta}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120}>
            <p className="mt-5 text-center text-[0.78rem] text-ink-3">
              Plan credits are illustrative in this preview ·{" "}
              <Link href="/pricing" className="font-semibold text-lav-700 underline-offset-4 hover:underline">
                see full Naira price list
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---------- TESTIMONIALS ---------- */}
      <section className="py-6 sm:py-10">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <span className="eyebrow">06 / Kind words</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.6rem]">
                Calm tools make{" "}
                <span className="text-display italic text-lav-700">quiet fans.</span>
              </h2>
            </Reveal>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {testimonials.map((item, index) => (
              <Reveal key={item.name} delay={index * 80}>
                <figure className="flex h-full flex-col rounded-[1.5rem] border border-line bg-[#fffdfa] p-6">
                  <div className="flex items-center gap-0.5 text-lav-500">
                    {Array.from({ length: 5 }).map((_, starIndex) => (
                      <Star key={starIndex} className="h-3.5 w-3.5" />
                    ))}
                  </div>
                  <blockquote className="mt-4 flex-1 text-[0.9rem] leading-relaxed text-ink-2">
                    “{item.quote}”
                  </blockquote>
                  <figcaption className="mt-5 flex items-center gap-3 border-t border-line/80 pt-4">
                    <Image
                      src={item.avatar}
                      alt={item.avatarAlt}
                      width={72}
                      height={72}
                      className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm"
                    />
                    <div>
                      <p className="text-[0.82rem] font-semibold">{item.name}</p>
                      <p className="text-[0.7rem] text-ink-3">{item.role}</p>
                    </div>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="py-20 sm:py-24">
        <div className="shell grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <Reveal>
              <span className="eyebrow">07 / Questions</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.5rem]">
                The things people
                <br />
                <span className="text-display italic text-lav-700">ask us first.</span>
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-sm text-[0.9rem] leading-relaxed text-ink-2">
                Still unsure about something? A real person replies from Lagos, usually within a few
                hours.
              </p>
            </Reveal>
            <Reveal delay={160}>
              <Link href="/contact" className="btn btn-ghost mt-6">
                Chat with support
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
          <Reveal delay={80}>
            <FaqAccordion items={faqs} />
          </Reveal>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="pb-6">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2.25rem] bg-ink px-6 py-12 text-white sm:px-12 sm:py-16">
              <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-lav-500/30 blur-[90px]" />
              <div className="pointer-events-none absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-lav-400/25 blur-[90px]" />

              <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-white/80">
                    <Sparkle className="h-3 w-3" />
                    Ready when you are
                  </span>
                  <h2 className="mt-5 max-w-lg text-[2rem] font-medium leading-[1.06] sm:text-[2.7rem]">
                    Your next verification
                    <br />
                    can take{" "}
                    <span className="text-display italic text-lav-200">two minutes.</span>
                  </h2>
                  <p className="mt-4 max-w-md text-[0.92rem] leading-relaxed text-white/70">
                    Create a free account, fund your wallet in Naira, and buy your first number,
                    eSIM or inbox today. Refunds are automatic, so there&apos;s little to lose.
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
                      How Pryva works
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3">
                  {[
                    { label: "Wallet funding", value: "Bank transfer or card, in Naira" },
                    { label: "Delivery", value: "Instant, inside your dashboard" },
                    { label: "Protection", value: "Auto-refund on undelivered codes" },
                    { label: "Built with", value: "Fleexa for numbers, eSIM, proxies" },
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
    </>
  );
}
