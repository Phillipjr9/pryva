import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark, hasBrand } from "@/components/brand/BrandMark";
import { Monogram } from "@/components/brand/Logo";
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Check,
  Clock,
  Globe,
  Lock,
  Mail,
  Phone,
  Shield,
  Sim,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { Reveal } from "@/components/ui/Reveal";
import { formatNaira, services, type ServiceSlug } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Pryva — Digital access, made simple",
  description:
    "Virtual numbers, travel eSIMs, residential proxies and email OTP in one calm workspace. Pay in Naira and get what you need in seconds.",
};

const serviceIcons = {
  numbers: Phone,
  esim: Sim,
  proxies: Globe,
  "email-otp": Mail,
} satisfies Record<ServiceSlug, typeof Phone>;

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
];

const benefits = [
  {
    icon: Wallet,
    title: "Pay the way you live",
    body: "Straight Naira pricing, local payment options, and no surprise currency conversions.",
    tone: "lavender",
  },
  {
    icon: Bolt,
    title: "Ready when you are",
    body: "Numbers, inboxes and activation details are delivered right in your workspace.",
    tone: "peach",
  },
  {
    icon: Shield,
    title: "A clear safety net",
    body: "If a verification code never arrives, eligible number orders are covered by a simple refund flow.",
    tone: "mint",
  },
  {
    icon: Lock,
    title: "Everything in one place",
    body: "Keep your orders, codes, wallet activity and support conversations together.",
    tone: "white",
  },
] as const;

const steps = [
  {
    number: "01",
    title: "Create your workspace",
    body: "Sign up in a minute or open the demo account to look around first.",
  },
  {
    number: "02",
    title: "Choose what you need",
    body: "Pick a virtual number, travel eSIM, residential proxy or temporary inbox.",
  },
  {
    number: "03",
    title: "Get on with your day",
    body: "Your details appear in Pryva, ready to copy, scan or use in your workflow.",
  },
];

const faqs = [
  {
    q: "Do I need a dollar card to use Pryva?",
    a: "No. Pryva is priced in Naira. You can fund your wallet with local payment methods and pay from that balance.",
  },
  {
    q: "What happens if my verification code does not arrive?",
    a: "Eligible number orders include refund protection. Open the order in your dashboard and follow the refund steps if the delivery window closes without a code.",
  },
  {
    q: "Can I use an eSIM with my current number?",
    a: "Yes. Pryva travel eSIMs are data-only, so you can keep your regular SIM and messaging number while using the eSIM for data abroad.",
  },
  {
    q: "Can I explore Pryva before creating an account?",
    a: "Yes. Choose the live demo on the sign-in page to open a sample dashboard without signing up.",
  },
];

function WorkspacePreview() {
  return (
    <div className="relative mx-auto w-full max-w-[35rem]">
      <div className="pointer-events-none absolute -inset-5 rounded-[3rem] bg-gradient-to-br from-lav-200/75 via-white/20 to-peach/70 blur-2xl" />
      <div className="relative rounded-[2rem] border border-white/90 bg-white/75 p-2.5 shadow-[var(--shadow-float)] backdrop-blur-xl sm:p-3.5">
        <div className="overflow-hidden rounded-[1.5rem] bg-[#211a30] text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10">
                <Monogram className="h-6 w-6" />
              </span>
              <div>
                <p className="text-[0.78rem] font-semibold">Pryva workspace</p>
                <p className="text-[0.62rem] text-white/50">Your digital toolkit</p>
              </div>
            </div>
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[0.6rem] font-medium text-white/70">
              Illustrative preview
            </span>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[0.65rem] font-medium text-white/50">MONDAY, 09:41 AM</p>
                <p className="mt-1 text-[1.2rem] font-medium tracking-tight sm:text-[1.45rem]">
                  Your workspace, at a glance.
                </p>
              </div>
              <span className="hidden items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1.5 text-[0.62rem] font-medium text-emerald-200 sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> All systems ready
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[0.82fr_1.18fr]">
              <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.07] p-4">
                <div className="flex items-center justify-between">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-lav-300/15 text-lav-100">
                    <Wallet className="h-4 w-4" />
                  </span>
                  <span className="text-[0.58rem] font-medium uppercase tracking-[0.12em] text-white/40">
                    Wallet
                  </span>
                </div>
                <p className="mt-5 text-[0.62rem] text-white/50">Available balance</p>
                <p className="mt-1 text-[1.45rem] font-semibold tracking-tight">₦25,000</p>
                <div className="mt-3 flex items-center gap-1.5 text-[0.62rem] text-emerald-200">
                  <Check className="h-3 w-3" /> Ready to use
                </div>
              </div>

              <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.07] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-white/45">
                    Recent verification
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[0.58rem] font-semibold text-emerald-200">
                    <Check className="h-2.5 w-2.5" /> Ready
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-[#171222] px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[0.9rem] text-ink">
                      🇳🇬
                    </span>
                    <div>
                      <p className="text-[0.78rem] font-semibold">+234 812 445 9081</p>
                      <p className="text-[0.6rem] text-white/45">WhatsApp · Nigeria</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-white/45" />
                </div>
                <div className="mt-2.5 flex items-center justify-between rounded-xl bg-lav-300/10 px-3 py-2">
                  <span className="text-[0.62rem] text-white/55">Verification code</span>
                  <span className="font-mono text-[0.8rem] font-semibold tracking-[0.2em] text-lav-100">
                    482 069
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { icon: Sim, label: "Travel eSIM", detail: "190+ destinations" },
                { icon: Globe, label: "Proxies", detail: "Residential IPs" },
                { icon: Mail, label: "Email OTP", detail: "Private inboxes" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-xl border border-white/10 bg-white/[0.045] px-2.5 py-3 sm:px-3"
                  >
                    <Icon className="h-3.5 w-3.5 text-lav-200" />
                    <p className="mt-2 text-[0.64rem] font-semibold sm:text-[0.7rem]">{item.label}</p>
                    <p className="mt-0.5 hidden text-[0.58rem] text-white/40 sm:block">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="absolute -left-4 top-[28%] hidden rounded-2xl border border-white/90 bg-white/95 p-3 shadow-[var(--shadow-soft)] sm:block lg:-left-7">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <Bolt className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold text-ink">Delivered in seconds</p>
              <p className="text-[0.6rem] text-ink-3">No waiting around</p>
            </div>
          </div>
        </div>

        <div className="absolute -right-3 bottom-[12%] hidden rounded-2xl border border-white/90 bg-white/95 p-3 shadow-[var(--shadow-soft)] sm:block lg:-right-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-lav-50 text-lav-700">
              <Shield className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold text-ink">Refund protection</p>
              <p className="text-[0.6rem] text-ink-3">Built into eligible orders</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="relative grain overflow-hidden pb-16 pt-10 sm:pb-20 sm:pt-16 lg:pb-24">
        <div className="pointer-events-none absolute -left-40 -top-32 h-[33rem] w-[33rem] rounded-full bg-lav-200/60 blur-[120px]" />
        <div className="pointer-events-none absolute -right-40 top-44 h-[31rem] w-[31rem] rounded-full bg-peach/65 blur-[130px]" />
        <div className="shell relative">
          <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10">
            <div className="max-w-2xl">
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-lav-200/80 bg-white/75 px-3.5 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-lav-800 shadow-sm backdrop-blur">
                  <span className="relative grid h-2 w-2 place-items-center">
                    <span className="absolute h-full w-full animate-ring rounded-full bg-emerald-500/70" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  </span>
                  Digital access, made simple
                </span>
              </Reveal>

              <Reveal delay={50}>
                <h1 className="mt-6 max-w-[12ch] text-[clamp(2.7rem,6.2vw,5rem)] font-medium leading-[0.98] tracking-[-0.055em]">
                  Your next step,
                  <br />
                  <span className="text-display italic text-lav-700">without the friction.</span>
                </h1>
              </Reveal>

              <Reveal delay={110}>
                <p className="mt-6 max-w-xl text-[1rem] leading-[1.8] text-ink-2 sm:text-[1.08rem]">
                  Virtual numbers, travel eSIMs, residential proxies and temporary inboxes — one calm
                  workspace, priced in Naira and ready when you are.
                </p>
              </Reveal>

              <Reveal delay={170}>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link href="/pricing" className="btn btn-primary !px-6 !py-3.5">
                    Explore services
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/login" className="btn btn-ghost !px-6 !py-3.5">
                    Try the live demo
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={230}>
                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5 text-[0.78rem] text-ink-2">
                  {[
                    "Naira-first pricing",
                    "Instant delivery",
                    "Refund protection",
                  ].map((item) => (
                    <span key={item} className="inline-flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-lav-600" /> {item}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={100} className="relative">
              <WorkspacePreview />
            </Reveal>
          </div>

          <Reveal delay={260}>
            <div className="mt-14 grid gap-3 border-t border-line/80 pt-6 sm:grid-cols-3 lg:mt-16">
              {[
                { value: "4 services", label: "One workspace for your digital toolkit" },
                { value: "Naira-native", label: "No foreign card or surprise conversion" },
                { value: "On demand", label: "Get details as soon as you need them" },
              ].map((item) => (
                <div key={item.value} className="flex items-center gap-3 sm:justify-center">
                  <span className="text-[0.92rem] font-semibold tracking-tight text-ink">{item.value}</span>
                  <span className="hidden h-1 w-1 rounded-full bg-lav-400 sm:block" />
                  <span className="text-[0.74rem] text-ink-3">{item.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative z-10 -mt-3 pb-5 sm:pb-8">
        <div className="shell">
          <Reveal>
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className="eyebrow">The Pryva toolkit</span>
                <h2 className="mt-2 max-w-2xl text-[1.85rem] font-medium leading-[1.08] tracking-tight sm:text-[2.4rem]">
                  Four useful tools. <span className="text-display italic text-lav-700">One easy place.</span>
                </h2>
              </div>
              <Link href="/pricing" className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-lav-700 hover:underline">
                Compare all plans <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {services.map((service, index) => {
              const Icon = serviceIcons[service.slug];
              return (
                <Reveal key={service.slug} delay={index * 55}>
                  <Link
                    href={service.href}
                    className="group flex h-full min-h-[15.5rem] flex-col rounded-[1.4rem] border border-line bg-[#fffdfa]/90 p-5 shadow-[0_16px_45px_-38px_rgba(72,52,120,0.55)] transition-all duration-300 hover:-translate-y-1 hover:border-lav-200 hover:bg-white hover:shadow-[var(--shadow-card)]"
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-lav-50 text-lav-700 transition-colors group-hover:bg-lav-100">
                        <Icon className="h-5 w-5" />
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-ink-3 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-lav-700" />
                    </div>
                    <p className="mt-5 text-[1rem] font-semibold tracking-tight">{service.name}</p>
                    <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-3">{service.tagline}</p>
                    <div className="mt-auto flex items-end justify-between gap-2 pt-5">
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.14em] text-ink-3">From</p>
                        <p className="mt-0.5 text-[1.08rem] font-semibold">{formatNaira(service.fromPrice)}</p>
                      </div>
                      <span className="pb-0.5 text-right text-[0.68rem] text-ink-3">{service.unit}</span>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="overflow-hidden border-y border-line/70 bg-white/55 py-5 sm:py-6">
        <div className="shell flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <p className="shrink-0 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-ink-3">
            Made for the apps you already use
          </p>
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
            {platforms.filter(hasBrand).map((platform) => (
              <span key={platform} className="inline-flex shrink-0 items-center gap-2 text-[0.78rem] font-medium text-ink-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-white">
                  <BrandMark name={platform} className="h-3.5 w-3.5" tone="mono" />
                </span>
                {platform}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-ink py-16 text-white sm:py-20">
        <div className="pointer-events-none absolute -right-24 -top-32 h-[30rem] w-[30rem] rounded-full bg-lav-500/20 blur-[120px]" />
        <div className="shell relative">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-lav-200">
                  <Sparkle className="h-3.5 w-3.5" /> A simpler way through
                </span>
              </Reveal>
              <Reveal delay={50}>
                <h2 className="mt-4 max-w-xl text-[2rem] font-medium leading-[1.05] tracking-tight sm:text-[2.8rem]">
                  From first click to <span className="text-display italic text-lav-200">ready to go.</span>
                </h2>
              </Reveal>
              <Reveal delay={100}>
                <p className="mt-4 max-w-md text-[0.9rem] leading-relaxed text-white/65">
                  No scattered tools or confusing steps. Start with what you need, then keep the important details in one place.
                </p>
              </Reveal>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {steps.map((step, index) => (
                <Reveal key={step.number} delay={index * 70}>
                  <div className="h-full rounded-[1.35rem] border border-white/10 bg-white/[0.055] p-4 sm:p-5">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-lav-300/15 font-mono text-[0.74rem] font-semibold text-lav-100">
                      {step.number}
                    </span>
                    <h3 className="mt-5 text-[0.93rem] font-semibold">{step.title}</h3>
                    <p className="mt-2 text-[0.76rem] leading-relaxed text-white/60">{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/10 pt-5 text-[0.76rem] text-white/65">
            {[
              { icon: Wallet, text: "Local Naira pricing" },
              { icon: Clock, text: "Fast delivery" },
              { icon: Shield, text: "Clear refund coverage" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <span key={item.text} className="inline-flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-lav-200" /> {item.text}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative py-16 sm:py-20">
        <div className="shell grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <Reveal>
              <span className="eyebrow">Designed around your day</span>
            </Reveal>
            <Reveal delay={50}>
              <h2 className="mt-3 max-w-lg text-[2rem] font-medium leading-[1.08] tracking-tight sm:text-[2.75rem]">
                Useful details, <span className="text-display italic text-lav-700">without the noise.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-4 max-w-md text-[0.9rem] leading-relaxed text-ink-2">
                Pryva keeps everyday digital tasks simple, with clear prices and a dashboard that makes your next action obvious.
              </p>
            </Reveal>
            <Reveal delay={150}>
              <Link href="/how-it-works" className="btn btn-ghost mt-6">
                See how Pryva works <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {benefits.map((benefit, index) => {
              const Icon = benefit.icon;
              const toneClass = {
                lavender: "bg-lav-50 text-lav-700",
                peach: "bg-peach/70 text-[#8a583e]",
                mint: "bg-mint text-emerald-800",
                white: "bg-white text-lav-700",
              }[benefit.tone];
              return (
                <Reveal key={benefit.title} delay={index * 55}>
                  <article className="h-full rounded-[1.45rem] border border-line bg-white/75 p-5 transition-colors hover:bg-white sm:p-6">
                    <span className={`grid h-10 w-10 place-items-center rounded-2xl ${toneClass}`}>
                      <Icon className="h-[1.1rem] w-[1.1rem]" />
                    </span>
                    <h3 className="mt-5 text-[0.98rem] font-semibold tracking-tight">{benefit.title}</h3>
                    <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-2">{benefit.body}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-16 sm:pb-20">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-lav-200/80 bg-gradient-to-br from-lav-100 via-[#fbf7ff] to-cream px-6 py-8 sm:px-10 sm:py-10">
              <Monogram className="pointer-events-none absolute -right-8 -top-16 h-60 w-60 opacity-[0.12]" />
              <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
                <div className="max-w-2xl">
                  <span className="inline-flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-lav-800">
                    <Lock className="h-3.5 w-3.5" /> Clear prices. Calm process.
                  </span>
                  <h2 className="mt-3 text-[1.75rem] font-medium leading-[1.08] tracking-tight sm:text-[2.25rem]">
                    The right tool is closer than you think.
                  </h2>
                  <p className="mt-3 max-w-xl text-[0.88rem] leading-relaxed text-ink-2">
                    Start with one service, keep your details in one workspace, and add more only when you need them.
                  </p>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col">
                  <Link href="/signup" className="btn btn-primary">
                    Create your account <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/pricing" className="btn btn-ghost">
                    Browse pricing
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="pb-16 sm:pb-20">
        <div className="shell grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
          <div>
            <Reveal>
              <span className="eyebrow">Questions, answered</span>
            </Reveal>
            <Reveal delay={50}>
              <h2 className="mt-3 text-[2rem] font-medium leading-[1.08] tracking-tight sm:text-[2.5rem]">
                Good to know <span className="text-display italic text-lav-700">before you begin.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-3 max-w-sm text-[0.88rem] leading-relaxed text-ink-2">
                Straight answers about pricing, delivery and your first steps with Pryva.
              </p>
            </Reveal>
            <Reveal delay={140}>
              <Link href="/faq" className="inline-flex items-center gap-1.5 mt-4 text-[0.8rem] font-semibold text-lav-700 hover:underline">
                Visit the full FAQ <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Reveal>
          </div>
          <Reveal delay={70}>
            <FaqAccordion items={faqs} />
          </Reveal>
        </div>
      </section>

      <section className="pb-8">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-[#211a30] px-6 py-9 text-white sm:px-10 sm:py-12">
              <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-lav-500/25 blur-[90px]" />
              <div className="pointer-events-none absolute -bottom-36 left-1/3 h-64 w-64 rounded-full bg-peach/10 blur-[90px]" />
              <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
                <div className="max-w-2xl">
                  <span className="inline-flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-lav-200">
                    <Sparkle className="h-3.5 w-3.5" /> Begin in a couple of minutes
                  </span>
                  <h2 className="mt-3 text-[2rem] font-medium leading-[1.06] tracking-tight sm:text-[2.75rem]">
                    Make your next digital task feel <span className="text-display italic text-lav-200">easy.</span>
                  </h2>
                  <p className="mt-3 max-w-xl text-[0.88rem] leading-relaxed text-white/65">
                    Explore the services, start with the demo, or create your own Pryva workspace.
                  </p>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col">
                  <Link href="/signup" className="btn btn-primary">
                    Get started <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/login" className="btn border border-white/20 bg-white/10 text-white hover:bg-white/15">
                    Open the demo
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
