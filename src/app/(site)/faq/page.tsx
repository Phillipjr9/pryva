import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { FaqAccordion, type FaqItem } from "@/components/ui/FaqAccordion";
import { ArrowRight, Chat, Mail, Shield } from "@/components/icons";

export const metadata: Metadata = {
  title: "FAQ — answers before you buy",
  description:
    "Answers about Pryva virtual numbers, rentals, eSIM data, residential proxies, email OTP, Naira payments, wallet top-ups and automatic refunds.",
};

const groups: { title: string; description: string; items: FaqItem[] }[] = [
  {
    title: "Getting started",
    description: "Accounts, payments and what you actually need to begin.",
    items: [
      {
        q: "Do I need a dollar card to use Pryva?",
        a: "No. Everything is priced and paid in Naira. Fund your wallet with a Nigerian bank transfer or a local debit card, then pay for orders from that balance.",
      },
      {
        q: "Is there a minimum top-up?",
        a: "Yes — ₦2,000. That is enough for a temporary inbox, a Nigerian verification number and a little left over to test another country.",
      },
      {
        q: "Do I need to verify my identity?",
        a: "No BVN, passport or selfie is required to create a Pryva account. You only need a name, an email address and a password.",
      },
      {
        q: "Can I use Pryva on my phone?",
        a: "Yes. The site is built mobile-first, so buying a number, copying a code or funding your wallet works comfortably from a phone browser.",
      },
    ],
  },
  {
    title: "Virtual numbers & rentals",
    description: "What works, what doesn't, and how refunds are decided.",
    items: [
      {
        q: "Are the numbers real or VoIP?",
        a: "They are real, carrier-grade numbers sourced through our provider Fleexa. Being non-VoIP is why verification codes from WhatsApp, Telegram, Google and most fintech platforms arrive reliably.",
      },
      {
        q: "What's the difference between buying and renting?",
        a: "Buying covers a single verification with a 20-minute code window. Renting keeps the same number active for 7, 30 or 90 days so you can receive multiple codes and keep a consistent identity.",
      },
      {
        q: "Can I choose a specific Nigerian number?",
        a: "Numbers are allocated from a live pool, so exact digits can't be reserved. If a platform rejects the line you received, request an auto-refund and buy another attempt — or message support for a replacement.",
      },
      {
        q: "When is an order refundable?",
        a: "Number orders are refundable whenever the delivery window closes without a verification code. Tap Request auto-refund on the order page and the amount returns to your wallet instantly.",
      },
      {
        q: "Which platforms work best?",
        a: "WhatsApp, Telegram, Google, TikTok, Binance, Discord, PayPal and most marketplaces work well. Some platforms aggressively block shared numbers; if that happens, the order is refundable, so you can try a rental instead.",
      },
    ],
  },
  {
    title: "eSIM, proxies & email OTP",
    description: "The details for our data, bandwidth and inbox products.",
    items: [
      {
        q: "Will an eSIM work with my phone?",
        a: "Most phones released from 2020 onward support eSIM — iPhone XS and newer, recent Samsung flagships, Pixel 4 and newer, and many iPads. Check your device settings for “Add eSIM” before buying.",
      },
      {
        q: "Can I keep my Nigerian WhatsApp number while using a Pryva eSIM?",
        a: "Yes. Pryva eSIMs are data-only, so they run alongside your existing SIM. Keep WhatsApp, bank alerts and calls on your primary line and use the eSIM for data abroad.",
      },
      {
        q: "What is a residential proxy, exactly?",
        a: "It routes your traffic through a real consumer connection rather than a data center, so websites see a genuine local IP. Pryva offers rotating requests and sticky sessions of up to 30 minutes.",
      },
      {
        q: "Do proxy credits expire?",
        a: "Bandwidth is available for 30 days from purchase. Unused gigabytes are not refundable after that window, so start with a 1GB pack if you're testing a workflow.",
      },
      {
        q: "How long does a temporary inbox last?",
        a: "Choose 24 hours for a single signup, or 30 days for a long-term address. Inboxes receive verification mail live in your dashboard with full message previews.",
      },
    ],
  },
  {
    title: "Wallet, refunds & support",
    description: "How money moves and how to reach a person.",
    items: [
      {
        q: "How do refunds reach me?",
        a: "Refunds go straight back into your Pryva wallet, along with a transaction reference in your wallet history. From there you can spend it or ask support to review a bank payout.",
      },
      {
        q: "Does my wallet balance expire?",
        a: "Unused wallet balance stays valid for 90 days from your last activity. Plan credits follow the same rule, so there is no monthly scramble.",
      },
      {
        q: "How do I speak to a human?",
        a: "Email support@pryva.ng, message us on WhatsApp, or use the contact form. Support runs 9am–8pm WAT, Monday to Saturday, with most replies inside two working hours.",
      },
      {
        q: "Do you offer business accounts and invoices?",
        a: "Yes. Pryva Business includes a shared team wallet, a dedicated Nigerian proxy pool, monthly invoices and an account manager. Get in touch with your expected monthly volume.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <section className="relative grain overflow-hidden pb-10 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[24rem] w-[36rem] -translate-x-1/2 rounded-full bg-lav-200/40 blur-[120px]" />
        <div className="shell relative">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <span className="eyebrow justify-center">Questions &amp; answers</span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="mt-4 text-[2.5rem] font-medium leading-[1.03] tracking-[-0.035em] sm:text-[3.3rem]">
                Ask away.
                <br />
                <span className="text-display italic text-lav-700">Nothing is too small.</span>
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mx-auto mt-5 max-w-xl text-[1rem] leading-relaxed text-ink-2">
                Everything we get asked most, grouped so you can find it fast. If your question
                isn&apos;t here, support will answer personally.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="pb-12">
        <div className="shell grid gap-10 lg:grid-cols-[1fr_2fr] lg:items-start">
          <div className="lg:sticky lg:top-24">
            <div className="rounded-2xl border border-line bg-white/70 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-lav-50 text-lav-700">
                <Chat className="h-4 w-4" />
              </span>
              <h2 className="mt-3.5 text-[1rem] font-semibold">Still stuck?</h2>
              <p className="mt-1.5 text-[0.83rem] leading-relaxed text-ink-2">
                Message a real person in Lagos. Most questions get a reply within two working hours.
              </p>
              <Link href="/contact" className="btn btn-primary mt-4 w-full !py-3 !text-[0.82rem]">
                Contact support
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <a
                href="mailto:support@pryva.ng"
                className="mt-2.5 flex items-center justify-center gap-1.5 text-[0.76rem] font-medium text-ink-2 hover:text-lav-700"
              >
                <Mail className="h-3.5 w-3.5" /> support@pryva.ng
              </a>
            </div>
            <div className="mt-3 rounded-2xl border border-lav-200 bg-lav-50/70 p-5">
              <p className="flex items-center gap-2 text-[0.83rem] font-semibold text-ink">
                <Shield className="h-4 w-4 text-lav-700" />
                Refund promise
              </p>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-2">
                No code inside the delivery window? The amount returns to your wallet automatically —
                no ticket required.
              </p>
            </div>
          </div>

          <div className="grid gap-8">
            {groups.map((group, groupIndex) => (
              <Reveal key={group.title} delay={groupIndex * 50}>
                <div>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[1.2rem] font-medium">{group.title}</h2>
                    <p className="text-[0.76rem] text-ink-3">{group.description}</p>
                  </div>
                  <FaqAccordion items={group.items} defaultOpen={groupIndex === 0 ? 0 : null} />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
