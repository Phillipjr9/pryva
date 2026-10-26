import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { PlanPurchase } from "@/components/purchase/PlanPurchase";
import { Monogram } from "@/components/brand/Logo";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Globe,
  Lock,
  Mail,
  Phone,
  Shield,
  Sim,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { formatNaira, plansFor, services, type Service, type ServiceSlug } from "@/lib/catalog";
import { BrandMark, hasBrand } from "@/components/brand/BrandMark";
import { getCurrentUser, isDemoUser } from "@/lib/auth";
import { hasDatabase } from "@/db";
import { isPaystackConfigured } from "@/lib/paystack";

const iconMap = {
  phone: Phone,
  sim: Sim,
  globe: Globe,
  mail: Mail,
} as const;

const clipChips = ["WhatsApp", "Telegram", "Google", "Binance", "TikTok", "Discord"];

function ServiceVisual({ slug, service }: { slug: ServiceSlug; service: Service }) {
  if (slug === "numbers") {
    return (
      <div className="relative rounded-[1.75rem] border border-white bg-white/85 p-4 shadow-[var(--shadow-float)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Number issued
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-lav-50 px-2 py-1 text-[0.6rem] font-semibold text-lav-700">
            <Clock className="h-2.5 w-2.5" /> 20 min window
          </span>
        </div>
        <div className="mt-3.5 flex items-center justify-between rounded-2xl border border-line bg-cream/70 p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[1rem] shadow-sm">
              🇳🇬
            </span>
            <div>
              <p className="text-[0.88rem] font-semibold tracking-tight">+234 812 445 9081</p>
              <p className="text-[0.64rem] text-ink-3">Non-VoIP · reusable rental</p>
            </div>
          </div>
          <Copy className="h-4 w-4 text-ink-3" />
        </div>
        <div className="mt-3 rounded-2xl bg-gradient-to-br from-lav-50 to-white p-3.5">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
            Incoming SMS
          </p>
          <div className="mt-2.5 flex gap-1.5">
            {["8", "3", "1", "4", "0", "7"].map((digit, index) => (
              <span
                key={index}
                className="grid h-9 flex-1 place-items-center rounded-lg border border-line bg-white text-[0.92rem] font-semibold text-ink"
              >
                {digit}
              </span>
            ))}
          </div>
          <p className="mt-2.5 flex items-center gap-1 text-[0.62rem] text-emerald-600">
            <Check className="h-3 w-3" /> Delivered in 9 seconds
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {clipChips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-1 text-[0.6rem] font-medium text-ink-2"
            >
              <BrandMark name={chip} className="h-2.5 w-2.5" />
              {chip}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (slug === "esim") {
    return (
      <div className="relative">
        <div className="rounded-[1.75rem] border border-white bg-white/85 p-4 shadow-[var(--shadow-float)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
              <Sim className="h-3 w-3 text-lav-600" /> Europe · 5GB
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[0.6rem] font-semibold text-emerald-600">
              Installed
            </span>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-2xl border border-line bg-gradient-to-br from-lav-100 to-white">
              <div className="grid grid-cols-3 gap-0.5">
                {Array.from({ length: 9 }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-2.5 w-2.5 rounded-[2px] ${
                      [0, 2, 3, 5, 7, 8].includes(index) ? "bg-ink" : "bg-ink/10"
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-[0.72rem] text-ink-3">Data remaining</p>
              <p className="text-[1.15rem] font-semibold">3.6 GB of 5 GB</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-lav-100">
                <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-lav-400 to-lav-600" />
              </div>
              <p className="mt-2 text-[0.62rem] text-ink-3">Expires in 24 days · 38 countries</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            {[
              { icon: "🇪🇺", label: "Europe" },
              { icon: "🇺🇸", label: "USA" },
              { icon: "🌍", label: "Global" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-line bg-cream/60 px-2 py-2 text-center"
              >
                <span className="text-[0.9rem]">{item.icon}</span>
                <p className="text-[0.62rem] font-medium text-ink-2">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute -bottom-5 -left-3 rounded-xl border border-white bg-white px-3.5 py-2.5 shadow-[var(--shadow-soft)]">
          <p className="text-[0.62rem] font-semibold text-ink">Keep your WhatsApp</p>
          <p className="text-[0.56rem] text-ink-3">Data-only · no roaming fees</p>
        </div>
      </div>
    );
  }

  if (slug === "proxies") {
    return (
      <div className="relative rounded-[1.75rem] border border-white bg-white/85 p-4 shadow-[var(--shadow-float)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
            <Globe className="h-3 w-3 text-lav-600" /> Residential pool
          </span>
          <span className="rounded-full bg-lav-50 px-2 py-1 text-[0.6rem] font-semibold text-lav-700">
            NG + US + EU
          </span>
        </div>
        <div className="mt-3.5 rounded-2xl bg-ink p-3.5 text-white">
          <p className="text-[0.58rem] uppercase tracking-[0.14em] text-white/50">Endpoint</p>
          <p className="mt-1 font-mono text-[0.76rem]">gate.pryva.ng:8000</p>
          <div className="mt-2.5 flex items-center gap-2 text-[0.62rem] text-white/70">
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">user_pryva</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">••••••••</span>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2">
            <span className="text-[0.7rem] text-ink-2">🇳🇬 Lagos · sticky</span>
            <span className="text-[0.62rem] font-semibold text-emerald-600">Online</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2">
            <span className="text-[0.7rem] text-ink-2">🇺🇸 New York · rotating</span>
            <span className="text-[0.62rem] font-semibold text-emerald-600">Online</span>
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-lav-50 px-3 py-2.5">
          <div className="flex items-center justify-between text-[0.62rem] text-ink-2">
            <span>Bandwidth used</span>
            <span className="font-semibold">1.2 GB / 5 GB</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
            <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-lav-400 to-lav-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-[1.75rem] border border-white bg-white/85 p-4 shadow-[var(--shadow-float)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
          <Mail className="h-3 w-3 text-lav-600" /> Temporary inbox
        </span>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[0.6rem] font-semibold text-emerald-600">
          Live
        </span>
      </div>
      <div className="mt-3 rounded-xl border border-line bg-cream/60 px-3 py-2.5">
        <p className="text-[0.58rem] uppercase tracking-[0.12em] text-ink-3">Your address</p>
        <p className="mt-0.5 font-mono text-[0.72rem] text-ink">launch-4f2@pryva.ink</p>
      </div>
      <div className="mt-3 space-y-2">
        {[
          { from: "Google", subject: "Verify your new account", code: "904 118" },
          { from: "Discord", subject: "Your login code", code: "276 004" },
        ].map((mail) => (
          <div key={mail.from} className="rounded-xl border border-line bg-white px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[0.7rem] font-semibold text-ink">{mail.from}</p>
              <span className="text-[0.56rem] text-ink-3">now</span>
            </div>
            <p className="text-[0.64rem] text-ink-3">{mail.subject}</p>
            <p className="mt-1.5 font-mono text-[0.86rem] font-semibold tracking-[0.18em] text-lav-700">
              {mail.code}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-lav-50 px-3 py-2 text-[0.62rem]">
        <span className="inline-flex items-center gap-1 text-ink-2">
          <Clock className="h-3 w-3 text-lav-600" /> Expires in 23h 48m
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-lav-700">
          <Shield className="h-3 w-3" /> {formatNaira(service.fromPrice)}
        </span>
      </div>
    </div>
  );
}

function CrossSell({ current }: { current: ServiceSlug }) {
  const others = services.filter((service) => service.slug !== current);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {others.map((service) => {
        const Icon = iconMap[service.icon];
        return (
          <Link
            key={service.slug}
            href={service.href}
            className="group flex items-start justify-between gap-3 rounded-2xl border border-line bg-white/60 p-4 transition-all hover:-translate-y-0.5 hover:border-lav-200 hover:bg-white"
          >
            <div>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-lav-700">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="mt-3 text-[0.86rem] font-semibold text-ink">{service.name}</p>
              <p className="text-[0.7rem] text-ink-3">From {formatNaira(service.fromPrice)}</p>
            </div>
            <ArrowUpRight className="h-4 w-4 text-ink-3 transition-colors group-hover:text-lav-600" />
          </Link>
        );
      })}
    </div>
  );
}

export async function ServicePageTemplate({ service }: { service: Service }) {
  const user = await getCurrentUser();
  const readOnlyDemo = !hasDatabase || isDemoUser(user);
  const allPlans = plansFor(service.slug);

  const groups =
    service.slug === "numbers"
      ? [
          {
            label: "One-time verification",
            plans: allPlans.filter((plan) => !plan.duration.startsWith("Rent")),
          },
          { label: "Rent a number", plans: allPlans.filter((plan) => plan.duration.startsWith("Rent")) },
        ].filter((group) => group.plans.length > 0)
      : [{ label: service.name, plans: allPlans }];

  return (
    <>
      <section className="relative grain overflow-hidden pb-14 pt-10 sm:pt-14">
        <div className="pointer-events-none absolute left-[-10rem] top-[-8rem] h-[26rem] w-[26rem] rounded-full bg-lav-200/40 blur-[110px]" />
        <div className="shell relative">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Reveal>
                <div className="flex flex-wrap items-center gap-2 text-[0.72rem] text-ink-3">
                  <Link href="/" className="hover:text-lav-700">
                    Home
                  </Link>
                  <span>/</span>
                  <span className="font-medium text-ink-2">{service.name}</span>
                </div>
              </Reveal>
              <Reveal delay={50}>
                <span className="eyebrow mt-5 inline-flex">
                  <Sparkle className="h-3 w-3" /> {service.eyebrow}
                </span>
              </Reveal>
              <Reveal delay={100}>
                <h1 className="mt-4 text-[2.4rem] font-medium leading-[1.03] tracking-[-0.035em] sm:text-[3.2rem]">
                  {service.tagline.split(".")[0].replace(/,?$/, ".")}
                  <br />
                  <span className="text-display italic text-lav-700">
                    {service.tagline.split(".").slice(1).join(".").trim() ||
                      {
                        numbers: "Delivered in seconds.",
                        esim: "Scan once, travel lighter.",
                        proxies: "No data-center tell.",
                        "email-otp": "Not your real inbox.",
                      }[service.slug]}
                  </span>
                </h1>
              </Reveal>
              <Reveal delay={150}>
                <p className="mt-5 max-w-xl text-[0.96rem] leading-relaxed text-ink-2">
                  {service.intro}
                </p>
              </Reveal>
              <Reveal delay={200}>
                <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
                  <Link href="#buy" className="btn btn-primary !px-6 !py-3.5">
                    Choose a plan
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/contact" className="btn btn-ghost !px-6 !py-3.5">
                    Ask a question
                  </Link>
                </div>
              </Reveal>
              <Reveal delay={250}>
                <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.78rem] text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-lav-600" /> Pay in Naira
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-lav-600" /> Instant delivery
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-lav-600" /> Auto-refund
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-lav-600" /> Secure checkout
                  </span>
                </div>
              </Reveal>
            </div>

            <Reveal delay={180} className="relative">
              <div className="mx-auto max-w-[25rem]">
                <div className="absolute inset-x-8 top-6 -z-10 h-full rounded-[2.5rem] bg-gradient-to-br from-lav-200/70 via-white/30 to-peach/50 blur-[2px]" />
                <ServiceVisual slug={service.slug} service={service} />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="pb-4">
        <div className="shell grid gap-3 sm:grid-cols-3">
          {service.highlights.map((highlight, index) => (
            <Reveal key={highlight.title} delay={index * 60}>
              <div className="h-full rounded-2xl border border-line bg-white/60 p-5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-[0.7rem] font-bold text-lav-700">
                  0{index + 1}
                </span>
                <h2 className="mt-3 text-[0.95rem] font-semibold">{highlight.title}</h2>
                <p className="mt-1.5 text-[0.83rem] leading-relaxed text-ink-2">{highlight.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-2xl">
            <Reveal>
              <span className="eyebrow">Pick your plan</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-3 text-[1.9rem] font-medium leading-[1.1] sm:text-[2.4rem]">
                Straight Naira prices.{" "}
                <span className="text-display italic text-lav-700">No conversion games.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-3 text-[0.92rem] leading-relaxed text-ink-2">
                {user
                  ? `Your wallet balance is ${formatNaira(user.walletBalance)}. Review the service and total before confirming payment.`
                  : "Sign in to review an order and pay from your Pryva wallet. Creating an account takes under a minute."}
              </p>
            </Reveal>
          </div>

          <div className="mt-8">
            <PlanPurchase
              groups={groups}
              signedIn={Boolean(user)}
              walletBalance={user?.walletBalance ?? null}
              nextPath={service.href}
              readOnlyDemo={readOnlyDemo}
              paystackReady={hasDatabase && !readOnlyDemo && isPaystackConfigured()}
            />
          </div>
        </div>
      </section>

      <section className="pb-4">
        <div className="shell grid gap-4 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-[1.5rem] border border-line bg-[#fffdfa] p-6">
              <h2 className="text-[1.1rem] font-semibold">What&apos;s included</h2>
              <ul className="mt-4 space-y-2.5">
                {service.included.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[0.87rem] text-ink-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-lav-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={70}>
            <div className="h-full rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-100/70 via-[#fbf7ff] to-white p-6">
              <h2 className="text-[1.1rem] font-semibold">Works well for</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {service.goodFor.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-2 rounded-full border border-lav-200/80 bg-white/80 px-3 py-1.5 text-[0.78rem] font-medium text-lav-800"
                  >
                    {hasBrand(item) && (
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-white shadow-sm ring-1 ring-line/60">
                        <BrandMark name={item} className="h-3 w-3" />
                      </span>
                    )}
                    {item}
                  </span>
                ))}
              </div>
              <p className="mt-5 flex items-start gap-2 text-[0.8rem] leading-relaxed text-ink-2">
                <Monogram className="mt-0.5 h-5 w-5 shrink-0" />
                Provisioned through Fleexa&apos;s infrastructure and monitored by the Pryva team in
                Lagos.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="shell grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <Reveal>
              <span className="eyebrow">{service.shortName} FAQ</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-3 text-[1.9rem] font-medium leading-[1.1]">
                Good to know{" "}
                <span className="text-display italic text-lav-700">before you buy.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <Link href="/faq" className="btn btn-ghost mt-5">
                All questions
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
          <Reveal delay={80}>
            <FaqAccordion items={[service.faqs[0], service.faqs[1]]} />
          </Reveal>
        </div>
      </section>

      <section className="pb-10">
        <div className="shell">
          <Reveal>
            <div className="mb-5 flex items-end justify-between gap-4">
              <h2 className="text-[1.3rem] font-medium">Also on Pryva</h2>
              <Link
                href="/pricing"
                className="text-[0.8rem] font-semibold text-lav-700 hover:underline"
              >
                Compare pricing
              </Link>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <CrossSell current={service.slug} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
