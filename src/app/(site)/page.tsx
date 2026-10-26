import Image from "next/image";
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

const servicePhotos: Record<ServiceSlug, { src: string; alt: string; width: number; height: number }> = {
  numbers: {
    src: "/images/landing/virtual-numbers.jpg",
    alt: "Hands holding a smartphone beside an open laptop.",
    width: 500,
    height: 333,
  },
  esim: {
    src: "/images/landing/travel-esim.jpg",
    alt: "A traveler checking her phone while standing with a suitcase.",
    width: 500,
    height: 333,
  },
  proxies: {
    src: "/images/landing/residential-proxies.jpg",
    alt: "A professional working at a laptop in a bright office.",
    width: 500,
    height: 749,
  },
  "email-otp": {
    src: "/images/landing/email-inbox.jpg",
    alt: "A laptop, smartphone and tablet arranged on a home-office desk.",
    width: 500,
    height: 334,
  },
};

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
    <div className="ph-vault">
      <div className="ph-vault-grid" aria-hidden="true" />
      <div className="ph-vault-orbit ph-vault-orbit-one" aria-hidden="true" />
      <div className="ph-vault-orbit ph-vault-orbit-two" aria-hidden="true" />
      <div className="ph-vault-coordinate" aria-hidden="true">
        P / 01 <span>YOUR DIGITAL TOOLKIT</span>
      </div>

      <div className="ph-vault-photo-frame">
        <Image
          src="/images/landing/hero-remote-work.jpg"
          alt="A professional working on a laptop while checking her phone in a bright workspace."
          width={1124}
          height={750}
          priority
          sizes="(min-width: 1024px) 42vw, 92vw"
          className="ph-vault-photo"
        />
        <div className="ph-vault-photo-overlay" aria-hidden="true" />
        <div className="ph-vault-photo-header">
          <span className="ph-vault-workspace-chip">
            <Monogram className="h-5 w-5" /> Pryva workspace
          </span>
          <span className="ph-vault-preview-chip">Illustrative preview</span>
        </div>

        <div className="ph-vault-photo-copy">
          <span>Numbers · eSIM · proxies · inboxes</span>
          <p>Keep your digital tools close.</p>
          <small>One calm workspace for the little things that keep you moving.</small>
        </div>
      </div>

      <div className="ph-vault-status-card">
        <div className="ph-vault-card-heading">
          <span className="ph-vault-check"><Check className="h-4 w-4" /></span>
          <span><strong>Code received</strong><small>WhatsApp · Nigeria</small></span>
        </div>
        <p>482 069</p>
      </div>

      <div className="ph-vault-balance-card">
        <div><span>Sample wallet</span><Wallet className="h-3.5 w-3.5" /></div>
        <strong>₦25,000</strong>
        <small><i /> Demo balance</small>
      </div>

      <div className="ph-vault-caption" aria-hidden="true">
        <span><i /> A CLEARER WAY TO GET CONNECTED</span>
        <span>MADE FOR YOUR NEXT MOVE</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="pryva-home">
      <section className="ph-hero relative grain overflow-hidden">
        <div className="ph-hero-ambient ph-hero-ambient-left" aria-hidden="true" />
        <div className="ph-hero-ambient ph-hero-ambient-right" aria-hidden="true" />
        <div className="shell ph-container relative">
          <div className="ph-hero-grid">
            <div className="ph-hero-copy">
              <Reveal>
                <span className="ph-announcement">
                  <span className="ph-status-dot" aria-hidden="true" />
                  Digital access, made simple
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Reveal>

              <Reveal delay={50}>
                <h1 className="ph-hero-title">
                  Your next step,
                  <br />
                  <span>without the<br />friction.</span>
                </h1>
              </Reveal>

              <Reveal delay={110}>
                <p className="ph-hero-description">
                  Virtual numbers, travel eSIMs, residential proxies and temporary inboxes — one calm
                  workspace, priced in Naira and ready when you are.
                </p>
              </Reveal>

              <Reveal delay={170}>
                <div className="ph-hero-actions">
                  <Link href="/pricing" className="ph-button ph-button-primary">
                    Explore services
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <Link href="/login" className="ph-secondary">
                    Try the live demo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={230}>
                <div className="ph-hero-note">
                  {[
                    "Naira-first pricing",
                    "Instant delivery",
                    "Refund protection",
                  ].map((item) => (
                    <span key={item}>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> {item}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={100} className="ph-hero-art">
              <WorkspacePreview />
            </Reveal>
          </div>

          <Reveal delay={260}>
            <div className="ph-hero-bottom">
              {[
                { value: "4 services", label: "One workspace for your digital toolkit" },
                { value: "Naira-native", label: "No foreign card or surprise conversion" },
                { value: "On demand", label: "Get details as soon as you need them" },
              ].map((item) => (
                <div key={item.value}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="ph-products relative z-10">
        <div className="shell ph-container">
          <Reveal className="ph-section-heading">
            <div>
              <span className="ph-eyebrow"><i /> THE PRYVA TOOLKIT</span>
              <h2>Four useful tools.<br />One easy place.</h2>
            </div>
            <div className="ph-section-heading-aside">
              <p>Everyday digital access, brought together in one clear workspace.</p>
              <Link href="/pricing" className="ph-link">
                Compare all plans <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>

          <div className="ph-product-grid">
            {services.map((service, index) => {
              const Icon = serviceIcons[service.slug];
              return (
                <Reveal key={service.slug} delay={index * 55} className="ph-product-entry">
                  <Link href={service.href} className="ph-product-card group">
                    <div className="ph-card-topline">
                      <span>0{index + 1} / {service.eyebrow}</span>
                      <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
                    </div>
                    <div className="ph-product-visual">
                      <Image
                        src={servicePhotos[service.slug].src}
                        alt={servicePhotos[service.slug].alt}
                        width={servicePhotos[service.slug].width}
                        height={servicePhotos[service.slug].height}
                        sizes="(min-width: 1280px) 260px, (min-width: 640px) 44vw, 90vw"
                        className="ph-product-image"
                      />
                      <div className="ph-product-image-wash" aria-hidden="true" />
                      <span className="ph-product-image-note">Made for your next move</span>
                    </div>
                    <h3>{service.name}</h3>
                    <p>{service.tagline}</p>
                    <div className="ph-product-bottom">
                      <span><small>From</small><strong>{formatNaira(service.fromPrice)}</strong><small>{service.unit}</small></span>
                      <span className="ph-product-link">Explore service <ArrowUpRight className="h-4 w-4" /></span>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="ph-platforms overflow-hidden border-y border-line/70 bg-white/55 py-5 sm:py-6">
        <div className="shell ph-container flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <p className="ph-platforms-label shrink-0 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-ink-3">
            Made for the apps you already use
          </p>
          <div className="ph-platform-list no-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
            {platforms.filter(hasBrand).map((platform) => (
              <span key={platform} className="ph-platform-item inline-flex shrink-0 items-center gap-2 text-[0.78rem] font-medium text-ink-2">
                <span className="ph-platform-mark grid h-7 w-7 place-items-center rounded-lg border border-line bg-white">
                  <BrandMark name={platform} className="h-3.5 w-3.5" tone="mono" />
                </span>
                {platform}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="ph-process relative overflow-hidden">
        <div className="ph-process-glow" aria-hidden="true" />
        <div className="shell ph-container ph-process-grid">
          <Reveal className="ph-process-art">
            <div className="ph-process-orbit ph-process-orbit-outer" aria-hidden="true" />
            <div className="ph-process-orbit ph-process-orbit-inner" aria-hidden="true" />
            <span className="ph-process-cross ph-process-cross-one" aria-hidden="true">+</span>
            <span className="ph-process-cross ph-process-cross-two" aria-hidden="true">+</span>
            <div className="ph-process-core"><Monogram className="h-64 w-64 sm:h-20 sm:w-20" /></div>
            <div className="ph-process-art-label"><span className="ph-status-dot" /> PRYVA / YOUR WORKSPACE</div>
            <div className="ph-process-card">
              <span className="ph-process-card-icon"><Shield className="h-4 w-4" /></span>
              <span><strong>All in one place</strong><small>Orders · codes · wallet · support</small></span>
              <Check className="ph-process-card-check h-4 w-4" />
            </div>
            <span className="ph-process-caption">ONE WORKSPACE. CLEAR NEXT STEPS.</span>
          </Reveal>

          <div className="ph-process-copy">
            <Reveal>
              <span className="ph-eyebrow ph-eyebrow-light"><i /> A SIMPLER WAY THROUGH</span>
            </Reveal>
            <Reveal delay={50}>
              <h2>From first click to<br /><span>ready to go.</span></h2>
            </Reveal>
            <Reveal delay={100}>
              <p>No scattered tools or confusing steps. Start with what you need, then keep the important details in one place.</p>
            </Reveal>
            <Reveal delay={150}>
              <div className="ph-process-accordion">
                <FaqAccordion
                  items={steps.map((step) => ({ q: `${step.number}  ${step.title}`, a: step.body }))}
                />
              </div>
            </Reveal>
            <div className="ph-process-proof">
              {[
                { icon: Wallet, text: "Local Naira pricing" },
                { icon: Clock, text: "Fast delivery" },
                { icon: Shield, text: "Clear refund coverage" },
              ].map((item) => {
                const Icon = item.icon;
                return <span key={item.text}><Icon className="h-3.5 w-3.5" /> {item.text}</span>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="ph-benefits relative py-16 sm:py-20">
        <div className="shell ph-container grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="ph-benefits-copy lg:sticky lg:top-28">
            <Reveal>
              <span className="ph-eyebrow"><i /> DESIGNED AROUND YOUR DAY</span>
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

          <div className="ph-benefit-grid grid gap-3 sm:grid-cols-2">
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
                  <article className="ph-benefit-card h-full rounded-[1.45rem] border border-line bg-white/75 p-5 transition-colors hover:bg-white sm:p-6">
                    <span className={`ph-benefit-icon grid h-10 w-10 place-items-center rounded-2xl ${toneClass}`}>
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

      <section className="ph-faq pb-16 sm:pb-20">
        <div className="shell ph-container grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
          <div className="ph-faq-intro">
            <Reveal>
              <span className="ph-eyebrow"><i /> QUESTIONS, ANSWERED</span>
            </Reveal>
            <Reveal delay={50}>
              <h2>Good to know<br /><span>before you begin.</span></h2>
            </Reveal>
            <Reveal delay={100}>
              <p>Straight answers about pricing, delivery and your first steps with Pryva.</p>
            </Reveal>
            <Reveal delay={140}>
              <Link href="/faq" className="ph-link">
                Visit the full FAQ <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
          <Reveal delay={70}>
            <div className="ph-faq-accordion">
              <FaqAccordion items={faqs} />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="ph-final-cta">
        <div className="shell ph-container ph-final-cta-shell">
          <Monogram className="ph-final-watermark h-64 w-64" />
          <Reveal className="ph-final-cta-content">
            <span className="ph-eyebrow"><i /> BEGIN IN A COUPLE OF MINUTES</span>
            <h2>Make your next digital task feel <span>easy.</span></h2>
            <p>Explore the services, start with the demo, or create your own Pryva workspace.</p>
            <div className="ph-final-actions">
              <Link href="/signup" className="ph-button ph-button-primary">
                Get started <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link href="/login" className="ph-secondary">
                Open the demo <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <span className="ph-final-caption">PRYVA · DIGITAL ACCESS, MADE SIMPLE</span>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
