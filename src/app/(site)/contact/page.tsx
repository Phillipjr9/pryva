import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { ContactForm } from "@/components/site/ContactForm";
import { FaqAccordion } from "@/components/ui/FaqAccordion";
import { hasDatabase } from "@/db";
import { getCurrentUser, isDemoUser } from "@/lib/auth";
import { ArrowRight, Chat, Clock, Mail, Refresh, Shield, Wallet } from "@/components/icons";

export const metadata: Metadata = {
  title: "Contact & support",
  description:
    "Talk to the Pryva team in Lagos. Support for virtual numbers, eSIMs, proxies, email OTP, wallet top-ups and refunds — replies within a few hours.",
};

const channels = [
  {
    icon: Chat,
    title: "Message from your dashboard",
    body: "Fastest for order issues and refunds. 9am – 8pm WAT, Monday to Saturday.",
    action: "Open a support message",
    href: "/dashboard/support",
  },
  {
    icon: Mail,
    title: "Email",
    body: "Best for invoices, partnerships and anything with screenshots attached.",
    action: "support@pryva.ng",
    href: "mailto:support@pryva.ng",
  },
  {
    icon: Clock,
    title: "Response times",
    body: "Most messages get a real human reply within 2 working hours. Sundays are slower.",
    action: "Check status",
    href: "/faq",
  },
];

const faqs = [
  {
    q: "My code hasn't arrived. What should I do?",
    a: "Open the order in your dashboard and wait for the delivery window shown on it. If it closes without a code, tap Request auto-refund — the full amount returns to your wallet immediately. You can still message us afterwards if anything looks off.",
  },
  {
    q: "Can you help me choose between buying and renting?",
    a: "If you need one verification, buy. If a number will represent your business on WhatsApp, socials or a fintech account for weeks, rent for 30 days. Tell us the platform and we'll recommend a country.",
  },
  {
    q: "Do you offer invoices for business accounts?",
    a: "Yes. Business plan customers get monthly invoices, a shared team wallet and an account manager. Send us a note with your company name and monthly volume.",
  },
];

export default async function ContactPage() {
  const user = await getCurrentUser();
  const readOnlyDemo = !hasDatabase || isDemoUser(user);

  return (
    <>
      <section className="relative grain overflow-hidden pb-12 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute left-[-8rem] top-[-8rem] h-[24rem] w-[24rem] rounded-full bg-lav-200/40 blur-[110px]" />
        <div className="shell relative">
          <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <div>
              <Reveal>
                <span className="eyebrow">Support</span>
              </Reveal>
              <Reveal delay={60}>
                <h1 className="mt-4 text-[2.4rem] font-medium leading-[1.03] tracking-[-0.035em] sm:text-[3.2rem]">
                  Real people,
                  <br />
                  <span className="text-display italic text-lav-700">real replies.</span>
                </h1>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-5 max-w-md text-[0.97rem] leading-relaxed text-ink-2">
                  Pryva is run from Lagos by a small team that uses these same services. Tell us
                  what you&apos;re trying to do and we&apos;ll point you in the right direction — no
                  scripts, no ticket maze.
                </p>
              </Reveal>

              <div className="mt-8 grid gap-2.5">
                {channels.map((channel, index) => {
                  const Icon = channel.icon;
                  return (
                    <Reveal key={channel.title} delay={150 + index * 60}>
                      <a
                        href={channel.href}
                        className="group flex items-start gap-3.5 rounded-2xl border border-line bg-white/60 p-4 transition-all hover:border-lav-200 hover:bg-white"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lav-50 text-lav-700">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[0.9rem] font-semibold text-ink">
                              {channel.title}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-ink-3 transition-colors group-hover:text-lav-600" />
                          </span>
                          <span className="mt-0.5 block text-[0.8rem] leading-relaxed text-ink-2">
                            {channel.body}
                          </span>
                          <span className="mt-1 block text-[0.76rem] font-semibold text-lav-700">
                            {channel.action}
                          </span>
                        </span>
                      </a>
                    </Reveal>
                  );
                })}
              </div>

              <Reveal delay={340}>
                <div id="refunds" className="mt-6 scroll-mt-28 rounded-2xl border border-lav-200 bg-lav-50/70 p-5">
                  <p className="flex items-center gap-2 text-[0.85rem] font-semibold text-ink">
                    <Shield className="h-4 w-4 text-lav-700" />
                    Refund policy, in one paragraph
                  </p>
                  <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-2">
                    If a number order produces no verification code inside its delivery window, the
                    full amount goes back to your wallet automatically — you don&apos;t need to ask.
                    Unused eSIM, proxy and inbox purchases can be reviewed within 24 hours if not
                    activated. Email{" "}
                    <a href="mailto:refunds@pryva.ng" className="font-medium text-lav-700 underline">
                      refunds@pryva.ng
                    </a>{" "}
                    if anything is unclear.
                  </p>
                </div>
              </Reveal>
            </div>

            <Reveal delay={100}>
              <div className="relative">
                <div className="mb-4 flex flex-wrap items-center gap-2 text-[0.74rem] text-ink-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1.5">
                    <Mail className="h-3.5 w-3.5 text-lav-600" /> support@pryva.ng
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1.5">
                    <Clock className="h-3.5 w-3.5 text-lav-600" /> Mon–Sat, 9am–8pm WAT
                  </span>
                </div>
                <ContactForm
                  defaultName={user?.name ?? ""}
                  defaultEmail={user?.email ?? ""}
                  signedIn={Boolean(user)}
                  readOnly={readOnlyDemo}
                />
                {!user && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.76rem] text-ink-3">
                    <Wallet className="h-3.5 w-3.5 text-lav-600" />
                    Have an account?
                    <Link href="/login" className="font-semibold text-lav-700 hover:underline">
                      Sign in
                    </Link>
                    to see your orders and wallet.
                  </p>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="py-14">
        <div className="shell grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <Reveal>
              <span className="eyebrow">Quick answers</span>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-3 text-[1.9rem] font-medium leading-[1.1]">
                Maybe we already
                <br />
                <span className="text-display italic text-lav-700">answered it.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <div className="mt-5 flex flex-col gap-2 text-[0.82rem] text-ink-2">
                <span className="inline-flex items-center gap-2">
                  <Refresh className="h-3.5 w-3.5 text-lav-600" /> Refunds land in your wallet, not
                  your bank
                </span>
                <span className="inline-flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-lav-600" /> All numbers are sourced via Fleexa
                </span>
              </div>
            </Reveal>
          </div>
          <Reveal delay={70}>
            <FaqAccordion items={faqs} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
